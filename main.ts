import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  request,
  normalizePath,
  TFile,
  TFolder,
} from "obsidian";

import vCard from "vcf";

interface ContactsSyncPluginSettings {
  icloudUserName: string;
  icloudPassword: string;
  peoplePath: string;
  includeContactsWithoutNames: boolean;
  includeContactInfoTagging: boolean;
}

const DEFAULT_SETTINGS: Partial<ContactsSyncPluginSettings> = {
  peoplePath: "people",
  includeContactsWithoutNames: false,
  includeContactInfoTagging: false,
};

async function getPrincipal(authHeaders: { Authorization: string }) {
  const res = await request({
    url: "https://contacts.icloud.com/home",
    method: "PROPFIND",
    headers: authHeaders,
    contentType: "text/xml",
  });
  const parser = new DOMParser().parseFromString(res, "text/xml");
  const principal = parser.querySelector(
    "current-user-principal > href"
  )?.textContent;
  if (!principal) {
    throw new Notice("Error retrieving current-user-principal");
  }
  return principal;
}

async function getAddressBook(
  principal: string,
  authHeaders: { Authorization: string }
) {
  const res = await request({
    url: `https://contacts.icloud.com${principal}`,
    method: "PROPFIND",
    headers: authHeaders,
    contentType: "text/xml",
    body: `<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <card:addressbook-home-set />4
  </d:prop>
</d:propfind>
    `,
  });
  const parser = new DOMParser().parseFromString(res, "text/xml");
  const addressBookHome = parser.querySelector(
    "addressbook-home-set > href"
  )?.textContent;
  if (!addressBookHome) {
    throw new Notice("Error retrieving addressbook-home-set");
  }
  return addressBookHome;
}

async function getContacts(
  addressBook: string,
  authHeaders: { Authorization: string }
) {
  const res = await request({
    url: addressBook,
    method: "REPORT",
    headers: authHeaders,
    contentType: "text/xml",
    body: `<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
      <d:getetag />
      <card:address-data />
  </d:prop>
</card:addressbook-query>`,
  });
  const parser = new DOMParser().parseFromString(res, "text/xml");
  const contacts = parser.querySelectorAll("address-data");
  if (!contacts) {
    throw new Notice("Error retrieving contacts");
  }
  return Array.from(contacts).map((e) => new vCard().parse(e.innerHTML));
}

function arrayify<T>(arg: T | T[] | undefined): T[] {
  return arg === undefined ? [] : Array.isArray(arg) ? arg : [arg];
}

function hasName(card: vCard) {
  const p = card.get("n");
  const first = arrayify(p)[0].toJSON()[3];
  return arrayify(first).some((v) => v.length);
}

function htmlDecode(input: string) {
  const doc = new DOMParser().parseFromString(input, "text/html");
  return doc.documentElement.textContent ?? undefined;
}

function formatPhoneNumber(phoneNumberString: string) {
  const cleaned = ("" + phoneNumberString).replace(/\D/g, "");
  const match = cleaned.match(/^(1|)?(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    const intlCode = match[1] ? "+1 " : "";
    return [intlCode, "(", match[2], ") ", match[3], "-", match[4]].join("");
  }
  return phoneNumberString;
}

type ParsedContactDetails = {
  uid: string;
  name?: string;
  org?: string;
  birthday?: string;
  address?: string[];
  note?: string;
  phoneNumbers?: string[];
  emails?: string[];
};

function formatYAMLArray(arr: string[]) {
  return arr.length > 1 ? arr.map((t) => `\n - ${t}`).join("") : arr[0];
}

function arrayToFrontmatterValue(arr?: string[]) {
  return arr === undefined || arr.length == 0
    ? undefined
    : arr.length == 1
    ? arr[0]
    : arr;
}

export default class ContactsSyncPlugin extends Plugin {
  settings: ContactsSyncPluginSettings;

  async doContactFileUpdate(
    file: TFile | undefined,
    path: string,
    details: ParsedContactDetails
  ) {
    const lines = [
      details.name && `Name: ${details.name}`,
      details.org && `Organization: ${details.org}`,
      details.address &&
        details.address.length &&
        `Address: ${formatYAMLArray(details.address)}`,
      details.birthday && `Birthday: ${details.birthday}`,
      details.emails &&
        details.emails.length &&
        `Email: ${formatYAMLArray(details.emails)}`,
      details.phoneNumbers &&
        details.phoneNumbers.length &&
        `Phone: ${formatYAMLArray(details.phoneNumbers)}`,
      details.uid && `SyncID: ${details.uid}`,
      details.note && `Note: ${details.note}`,
    ].filter(Boolean);

    let mismatch = false;
    if (!file) {
      await this.app.vault.create(path, `---\n${lines.join("\n")}\n---\n\n`);
    } else {
      this.app.fileManager.processFrontMatter(file, (md) => {
        if (md.SyncID != details.uid) {
          mismatch = true;
          return md;
        }
        md.Name = details.name;
        md.Address = arrayToFrontmatterValue(details.address);
        md.Note = details.note;
        md.Organization = details.org;
        md.Birthday = details.birthday;
        md.Email = arrayToFrontmatterValue(details.emails);
        md.Phone = arrayToFrontmatterValue(details.phoneNumbers);
        return md;
      });
    }
    return { mismatch };
  }

  async updateContact(contact: vCard) {
    const uid = contact.get("uid")?.valueOf().toString();
    const name = htmlDecode(contact.get("fn")?.valueOf().toString());
    const org = contact.get("org")?.valueOf().toString().replace(";", "");
    const birthday = contact.get("bday")?.valueOf().toString();
    const note = contact.get("note")?.valueOf().toString();
    const address = arrayify(contact.get("adr")).map((a) =>
      arrayify(a.toJSON()[3])
        .filter((s) => s.length)
        .join(", ")
        .replace("\\n", " ")
    );

    const phoneNumbers = arrayify(contact.get("tel")).map((p) => {
      const jCardProp = p.toJSON();
      const propType = arrayify(jCardProp[1].type).filter(
        (v) => !["voice", "pref"].includes(v)
      );
      return propType.length && this.settings.includeContactInfoTagging
        ? `${formatPhoneNumber(jCardProp[3].toString())} (${propType[0]})`
        : formatPhoneNumber(jCardProp[3].toString());
    });

    const emails = arrayify(contact.get("email")).map((p) => {
      const jCardProp = p.toJSON();
      const propType = arrayify(jCardProp[1].type).filter(
        (v) => !["internet", "pref"].includes(v)
      );
      return propType.length && this.settings.includeContactInfoTagging
        ? `${jCardProp[3].toString()} (${propType[0]})`
        : jCardProp[3].toString();
    });

    const filepath = normalizePath(`${this.settings.peoplePath}/${name}.md`);
    const disambiguatedFilepath = normalizePath(
      `${this.settings.peoplePath}/${name} (${uid.toString().split("-")[0]}).md`
    );

    const file = this.app.vault.getAbstractFileByPath(filepath);
    const disambiguatedFile = this.app.vault.getAbstractFileByPath(
      disambiguatedFilepath
    );

    const details: ParsedContactDetails = {
      uid,
      name,
      org,
      address,
      birthday,
      note,
      emails,
      phoneNumbers,
    };

    if (disambiguatedFile && !file && disambiguatedFile instanceof TFile) {
      this.app.fileManager.renameFile(disambiguatedFile, filepath);
      const file = this.app.vault.getAbstractFileByPath(filepath);
      this.doContactFileUpdate(file as TFile, filepath, details);
    } else if (disambiguatedFile instanceof TFile) {
      this.doContactFileUpdate(
        disambiguatedFile,
        disambiguatedFilepath,
        details
      );
    } else if (file instanceof TFolder) {
      this.doContactFileUpdate(undefined, disambiguatedFilepath, details);
    } else if (!file || file instanceof TFile) {
      if (details.name?.startsWith("Peter")) {
      }
      const { mismatch } = await this.doContactFileUpdate(
        file ?? undefined,
        filepath,
        details
      );
      if (mismatch) {
        this.doContactFileUpdate(undefined, disambiguatedFilepath, details);
      }
    }
  }

  async doSync() {
    const folderpath = normalizePath(this.settings.peoplePath);
    const folder = this.app.vault.getAbstractFileByPath(folderpath);
    if (folder instanceof TFile) {
      new Notice(`Error: "People path" option must be a folder.`);
      return;
    }
    if (!folder) {
      await this.app.vault.createFolder(folderpath);
      new Notice(`Created iCloud contacts folder "${folderpath}"`);
    }

    if (
      this.settings.icloudPassword.length == 0 ||
      this.settings.icloudUserName.length == 0
    ) {
      new Notice(`Error: Make sure you have entered valid iCloud credentials`);
      return;
    }

    new Notice("Starting iCloud contacts sync");

    const authHeaders = {
      Authorization:
        "Basic " +
        btoa(
          `${this.settings.icloudUserName.trim()}:${this.settings.icloudPassword.trim()}`
        ),
    };

    try {
      const principal = await getPrincipal(authHeaders);
      const addressBookHome = await getAddressBook(principal, authHeaders);
      const contacts = await getContacts(
        `${addressBookHome}card/`,
        authHeaders
      );
      const filteredContacts = this.settings.includeContactsWithoutNames
        ? contacts
        : contacts.filter(hasName);
      filteredContacts.forEach((c) => this.updateContact(c));
      new Notice("Completed iCloud contacts sync");
    } catch (e) {
      new Notice(`Error: Sync failed, check your iCloud credentials`);
    }
  }

  async onload() {
    await this.loadSettings();

    // This creates an icon in the left ribbon.
    this.addRibbonIcon("contact", "Sync iCloud Contacts", (evt: MouseEvent) => {
      this.doSync();
    });

    // This adds a command to trigger a sync
    this.addCommand({
      id: "sync-icloud-contacts",
      name: "Sync All Contacts",
      callback: () => {
        this.doSync();
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new ContactsSyncSettingsTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ContactsSyncSettingsTab extends PluginSettingTab {
  plugin: ContactsSyncPlugin;

  constructor(app: App, plugin: ContactsSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setName("iCloud Username").addText((text) =>
      text
        .setPlaceholder("Enter your username")
        .setValue(this.plugin.settings.icloudUserName)
        .onChange(async (value) => {
          this.plugin.settings.icloudUserName = value;
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName("iCloud Password")
      .setDesc("Generate an app-specific password at appleid.apple.com")
      .addText((text) => {
        text
          .setPlaceholder("Enter your password")
          .setValue(this.plugin.settings.icloudPassword)
          .onChange(async (value) => {
            this.plugin.settings.icloudPassword = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("People path")
      .setDesc("Where do you want to save your contacts in Obsidian?")
      .addText((text) => {
        text
          .setPlaceholder("/people")
          .setValue(this.plugin.settings.peoplePath)
          .onChange(async (value) => {
            this.plugin.settings.peoplePath = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Include contacts without names")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.includeContactsWithoutNames)
          .onChange(async (value) => {
            this.plugin.settings.includeContactsWithoutNames = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Include contact info tagging")
      .setDesc(
        "Eg. Add (home) or (work) to email and phone numbers when available"
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.includeContactInfoTagging)
          .onChange(async (value) => {
            this.plugin.settings.includeContactInfoTagging = value;
            await this.plugin.saveSettings();
          });
      });
  }
}
