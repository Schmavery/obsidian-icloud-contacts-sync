
# Intro

Recently I've been getting into using [Obsidian](https://obsidian.md/) to record and organize things in my life. It's a pretty great set of features, with an open-source codebase, flat file storage format and very extensible. I have a folder called "people" where I store notes about people in my life, to help me remember simple things like birthdays, where people work etc. At some point, I realized that there was a decent a
mount of duplicated information between Obsidian and my iPhone contacts and started looking for plugins to help unify them. Surprisingly, I didn't find any.

> Ideally, I'd like to populate relevant frontmatter (Obsidian metadata in the YAML format) into a note for each person in my contacts, creating a note if the person doesn't already have one. Existing note content and unrelated frontmatter tags should be preserved.

There's [no](https://medium.com/@noteapps/keeping-track-of-people-and-connections-in-obsidian-cfd6339b50c) [shortage](https://www.reddit.com/r/ObsidianMD/comments/vkk06z/does_anyone_use_obsidian_to_map_out_their_social/) of [other](https://www.reddit.com/r/ObsidianMD/comments/wen1fw/how_do_i_start_taking_people_notes/) [people](https://www.youtube.com/watch?v=sKF37Ng4gaI) using Obsidian to track people/connections in their lives, but not many plugins that help with it. At the time of writing this, there are only two plugins that show up with the search "contact". There's [ntawileh/obsidian-google-lookup](https://github.com/ntawileh/obsidian-google-lookup) that can help a bit if your contacts are in the Google ecosystem, though it seems to require you to import each contact individually. Then there's [vbeskrovnov/obsidian-contacts](https://github.com/vbeskrovnov/obsidian-contacts) which seems to be more about searching and organizing contact information.

The coolest part of Obsidian plugins is that they work on all clients, whether on your desktop or your phone. As a bonus, the docs are quite good and there are a lots of examples of other apps people have made. This made it feel pretty accessible to try and write one that would solve my problem.

I assumed that it would be impossible to get the contact information from iCloud, given how locked-down Apple frequently makes their products. However, I ran into [Obsidian Full Calendar](https://davish.github.io/obsidian-full-calendar/calendars/caldav/), which lets you sync events from iCloud using an [app-specific password](https://support.apple.com/en-us/HT204397) and a system called CalDAV.  A little research showed me that a similar system exists for contacts!
## CardDAV

It turns out that iCloud uses a protocol called [CardDAV](https://en.wikipedia.org/wiki/CardDAV) to make contact information accessible to external systems. 

I can't say that CardDAV ended up being the most straightforward system I've ever interacted with, so as I experimented using [HTTPie](https://httpie.io/) to manually make requests until I figured it out, keeping track in an Obsidian note (of course) as I went, so that I'd be able to convert it into code for the plugin afterwards.

The best resource I found ended up being [this document](https://sabre.io/dav/building-a-carddav-client/) by [sabre/dav](https://sabre.io/) explaining how to build a CardDAV client. The "Discovery" section ended up being especially helpful, since the biggest problem was just figuring out where to start. A couple of [StackOverflow](https://stackoverflow.com/questions/57920341/not-able-to-get-current-user-principal-for-user-from-apple-caldav-server) questions indicated that `contacts.icloud.com` was a good entrypoint.

Based on the sabre/dav article, I learned that CardDAV makes HTTP requests with funny methods and XML bodies in order to get most things done. The first one we use is PROPFIND. 

**PROPFIND** https://contacts.icloud.com/home
```xml
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
     <d:current-user-principal />
  </d:prop>
</d:propfind>
```

I made the PROPFIND request (and all subsequent requests) with HTTP Basic Auth set to my icloud username and the app-specific password mentioned earlier.

### Response
The response was some XML containing the following (ID changed for privacy):
```xml
...
<current-user-principal>
	<href>/1234567890/principal/</href>
</current-user-principal>
...
```

According to sabre/dav, this is the path I can use to get the "addressbook home", which contains the locations of all the addressbooks. The request was:

**PROPFIND** https://contacts.icloud.com/1234567890/principal/
```xml
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
     <card:addressbook-home-set />
  </d:prop>
</d:propfind>
```

### Response
```xml
...
<addressbook-home-set xmlns="urn:ietf:params:xml:ns:carddav">
	<href xmlns="DAV:">https://p133-contacts.icloud.com:443/1234567890/carddavhome/</href>
</addressbook-home-set>
...
```

This gave me a new URI that I could use to query for addressbook information! I had seen this `pXX-contacts.icloud.com`  pattern mentioned in one or two places so this was an encouraging sign.

**PROPFIND** https://p133-contacts.icloud.com:443/1234567890/carddavhome/
```xml
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
     <d:resourcetype />
  </d:prop>
</d:propfind>
```

### Response
```xml
...
<href>/1234567890/carddavhome/card/</href>
...
```

Finally, we have the URI of the addressbook itself! Now we get to make a new kind of request: a "REPORT" request, which will return all the contact info.

**REPORT** https://p133-contacts.icloud.com:443/1234567890/carddavhome/card/
```xml
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
    <d:prop>
        <d:getetag />
        <card:address-data />
    </d:prop>
</card:addressbook-query>
```

Amazingly, this worked and returned all of my contact data. It's in some weird messy-looking format, but at this point it seems like this plugin might actually be possible!

# Implementation
## Setting Up the Plugin Dev Environment

The documentation for creating an Obsidian plugin is pretty excellent, which is probably why there are so many! The best place to start is the [Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin) page, but I'll replicate the main steps I took here.

1. Create a new local vault for testing so that you don't need to risk messing up your real notes. Luckily this is easy, you can do it via the Obsidian UI.
2. Use the [obsidianmd/obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) template to create a GitHub repo for the new plugin. In this case, I called it obsidian-icloud-contacts-sync.
3. Clone the repo to your local development vault's plugin directory (I had to create the plugin dir) --  `dev_vault/.obsidian/plugins/icloud-contacts-sync`.
4. Update the name (and maybe description) in the package.json and manifest.json to make it a little less confusing.
5. Run `npm install` to install dependencies and `npm run dev` to build `main.js` (according to the sample README).
6. Install [pjeby/hot-reload](https://github.com/pjeby/hot-reload). Halfway through development, I realized I could use hot-reloadwhich made the development cycle much smoother. Before that, I was running `ctrl-p > Reload app without saving` every time I made a change. Big improvement!

Now we have a development environment ready to go, so we can start implementing the plugin!

## Getting Contacts data into the Plugin

I started by trying to hook one of the buttons in the sample project to a callback which would try to make the first call to the iCloud CardDAV server.  I replaced the notice in the callback for the ribbon icon with a call to new method called `doSync` that I can use to prototype my sync code.

```diff
const ribbonIconEl = this.addRibbonIcon('contact', 'Sample Plugin', (evt: MouseEvent) => {
--	// Called when the user clicks the icon.
--	new Notice('This is a notice!');
++  this.doSync();
});
```

> The original icon name (the first parameter to `addRibbonIcon`) was `'dice'`. It took me a while to figure out what the other possible icon names were, but I eventually found [this](https://docs.obsidian.md/Plugins/User+interface/Icons), which indicates that most of the [Lucide](https://lucide.dev/) icons can be used. Great!

Now, let's add a simple doSync method to the plugin:

```typescript
export default class ContactsSyncPlugin extends Plugin {
...
	async doSync() {
		const res = await fetch("https://contacts.icloud.com/home", {
		    method: "PROPFIND",
		    headers: authHeaders,
		  });
		console.log(res);
	}
...
}
```

 > Note: I renamed the classes in the sample plugin in accordance with the [Obsidian Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Rename+placeholder+class+names). The `ContactsSyncPlugin` class was originally named `MyPlugin`.
 
I used `fetch`  and immediately ran into CORS issues, since the plugins execute in a browser-like environment and iCloud doesn't provide any CORS headers. Luckily, in reading some other plugins, I saw a function called [request](https://docs.obsidian.md/Reference/TypeScript+API/request) being imported from the obsidian library and used to make HTTP requests.

It turns out, this is a common problem, and so the Obsidian developers included a work-around in their library! How convenient!

```typescript
import { request } from "obsidian";

...

const res = await request({
    url: "https://contacts.icloud.com/home",
    method: "PROPFIND",
    headers: { Authorization: "Basic " + btoa("iCloudUsername:iCloudPassword") },
    contentType: "text/xml",
  });  
```

This gives us back a pile of XML data. We can use [DOMParser.parseFromString](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString) , a function provided by the browser, to help parse it. Then we can query the parsed XML using selectors:

```typescript
  const parser = new DOMParser().parseFromString(res, "text/xml");
  const principal = parser.querySelector(
    "current-user-principal > href"
  )?.textContent;
```

Now we just need to repeat this for the 3 other CardDAV queries we need to make, and we get our data!

In the code above, the iCloud credentials are hardcoded. That isn't great for a plugin which is going to be used by other people. Luckily, Obsidian has a really simple settings system that lets us easily configure things like this. The sample app already comes with some example settings configured, so I replaced those with the ones I needed.

> Note: The class below was originally named `MyPluginSettings`.

```typescript
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
        // Set the input type to "password" to hide the password content
        text.inputEl.type = "password";
      });
  }
}
```

That was pretty easy, apart from a little fiddling around to get the password field to show up with the content hidden.

Since I'm using Typescript, we need to make sure to also update the `MyPluginSettings` interface and the `DEFAULT_SETTINGS` value correspondingly.

```typescript
interface ContactsSyncPluginSettings {
  icloudUserName: string;
  icloudPassword: string;
}

const DEFAULT_SETTINGS: Partial<ContactsSyncPluginSettings> = {};
```

Nice, now we have the iCloud username and password! Let's refactor that code from before into a function that takes the HTTP authorization headers as an argument, since we're going to need the same headers for all the CardDAV calls.

```typescript
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
```

Now we can just [write similar code](https://github.com/Schmavery/obsidian-icloud-contacts-sync/blob/805b0318d4d0f7bcfe99f6cf8f25b3f832ce9513/main.ts#L29-L94) for the other 3 CardDAV calls that we need to make. Actually, I cheated and skipped the second-to-last call, since it just seems to add `/card` to the end of the address book home URI. Hopefully this doesn't come back to haunt me.

At the end, we get the list of all contacts in the addressbook. Unfortunately, these are in a slightly funny vCard format, but after about 3 false starts accidentally installing abandoned npm packages, I managed to find one that works. 

```bash
npm install vcf
npm install -D @types/vcf
```

Now we can pass the data for each contact into `new vCard().parse()` in order to parse into a "slightly" more usable format. Time to create some notes!
## Creating Obsidian Notes

The sample plugin repo didn't have any examples of creating or updating notes, so I needed to do a little digging. After some reading of the API documentation, it seems that we want to use [`Vault.create()`](https://docs.obsidian.md/Reference/TypeScript+API/Vault/create) to create new files and [FileManager.processFrontMatter()](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter) to update existing ones.

Lets define a type that can hold the contact details we want to put into the front matter. 

> Note: Massaging the parsed vCard data into a pretty format is a little fiddly -- I'll gloss over it here so that this post doesn't become twice as long.

In general, the `ContactDetails` type contains useful information that existed on most of my contacts. The `SyncID` is an id used by CardDAV/iCloud to identify the contact. This can help us disambiguate people with the same name and eventually try to implement a two-way sync.

```typescript
type ContactDetails = {
  SyncID: string;
  Name?: string;
  Organization?: string;
  Birthday?: string;
  Address?: string[] | string | undefined;
  Note?: string;
  Phone?: string[] | string | undefined;
  Email?: string[] | string | undefined;
}
```

> Note: Normally in Typescript, I'd use lowercase key names, but since I wanted the frontmatter keys to be uppercase, we'll do that here.

Now we can use a  `ContactDetails` to create a new contact note.

```typescript
import { stringifyYaml } from "obsidian";

...
// Method on the ContactsSyncPlugin class
async createContact(path: string, contact: ContactDetails)
	await this.app.vault.create(
		path,
		`---\n${stringifyYaml(contact)}---\n\n`
	  );
```

For the update, [FileManager.processFrontMatter()](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter) provides us with the existing front matter, which we can then update and return.

```typescript
// Method on the ContactsSyncPlugin class
async updateContact(path: string, contact: ContactDetails)
    await this.app.fileManager.processFrontMatter(path, (frontMatter) => {
      Object.entries(contact).forEach(([k, v]) => {
        if (v) {
          frontMatter[k] = v;
        }
      });
      return frontMatter;
    });
```

Now we have functions that can create and update contact notes! Let's update our `doSync` function:

```typescript
const FOLDER_PATH = "/people"; // The folder where we want to create our notes

...

async doSync() {
    const folder = this.app.vault.getAbstractFileByPath(FOLDER_PATH);
    if (folder instanceof TFile) {
      new Notice(`Error: "People path" option must be a folder.`);
      return;
    }
    if (!folder) {
      await this.app.vault.createFolder(folderpath);
      new Notice(`Created iCloud contacts folder "${folderpath}"`);
    }
  
    if (
      !this.settings.icloudPassword.length ||
      !this.settings.icloudUserName.length
    ) 
      new Notice(`Error: Make sure you have entered valid iCloud credentials`);
      return;
    }
  
    new Notice("Starting iCloud contacts sync");
  
    const authHeaders = {
      Authorization:
        "Basic " +
        btoa(
         `${this.settings.icloudUserName}:${this.settings.icloudPassword}`
        ),
    };
  
    try {
      const principal = await getPrincipal(authHeaders);
      const addressBookHome = await getAddressBook(principal, authHeaders);
      const contacts: ContactDetails[] = await getContacts(
        `${addressBookHome}card/`,
        authHeaders
      );
      for (const contact of contacts) {
		  const filepath = normalizePath(`${FOLDER_PATH}/${contact.Name}.md`);
		  const file = this.app.vault.getAbstractFileByPath(filepath);

		  if (!file) this.createContact(filepath, contact);
		  if (file instanceof TFile) this.updateContact(filepath, contact);
      }
      contacts.forEach((c) => this.updateContact(c));
      new Notice("Completed iCloud contacts sync");
    } catch (e) {
      new Notice(`Error: Sync failed, check your iCloud credentials`);
    }
  }
```


> Note: The real `doSync` function is a little more complicated than this, because I try to handle disambiguating contacts with the same name using the SyncID. There are also a couple of options for filtering which contacts to sync.

At this point, we have a mostly working plugin. I spent a few days after this using and tweaking it, mostly improving the formatting of the contact data, since the parser didn't seem to produce very nice output. Maybe I'm just using it wrong.

# Wrapping Up

## Making a Release

Now that we have the main functionality of the plugin implemented, we need to figure out how to create a release we can easily install from the app. There's a fairly well-documented [process](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) for adding your plugin to the official list of Obsidian plugins, but that felt a little intimidating for something I wasn't sure anyone else would want to use. Luckily, there's also [BRAT](https://github.com/TfTHacker/obsidian42-brat), which lets you install a plugin directly from a GitHub release.

BRAT also has pretty good documentation (there's a theme here... thanks Obsidian devs/community!) for [installing a plugin](https://tfthacker.com/Obsidian+Plugins+by+TfTHacker/BRAT+-+Beta+Reviewer's+Auto-update+Tool/Quick+guide+for+using+BRAT) and [understanding how BRAT works](https://tfthacker.com/Obsidian+Plugins+by+TfTHacker/BRAT+-+Beta+Reviewer's+Auto-update+Tool/Special+notes+for+Developers). Basically, we still need to create a release as if we were going to make an official plugin, but we don't need to get any approvals.

The official Obsidian plugin docs have an [example GitHub Action](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions) that I'll try to use. I followed the instructions, but the build was failing, saying `HTTP 403: Resource not accessible by integration`. Luckily, [Stack Overflow](https://stackoverflow.com/questions/70435286/resource-not-accessible-by-integration-on-github-post-repos-owner-repo-ac/75250838#75250838) came to my rescue, and it turned out that I needed to enable "Read and Write permissions" for the workflow. Now the build worked!

I went to install the plugin using BRAT and it told me I had no `main.js` file! It took a surprising amount of troubleshooting before I realized that this was another GitHub-related issue. The GitHub action creates a draft release, so BRAT wasn't seeing any releases at all! Looking back at [the instructions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions), this is clearly mentioned. Oops!

## Going Forward

One interesting thing I realized in using the new plugin is that many of the contacts I see on my iPhone are actually from various different sources. I assumed they would all be represented in iCloud, but there were some that were synced from Google and other sources. To me, this highlighted the advantages of having all my contact information together in one spot (in Obsidian). This way I can have a little more control/understanding of where my data lives.

The plugin works now, but there are a few things that could be improved:

- The plugin would be easier to install if it was in the official plugin list. Right now, it's just me using it, so I haven't bothered, but if other people express an interest, I could do that.
- One thing that would be really nice, if a little scary, would be two-way sync. I'd love to be able to track and edit all my contact info in Obsidian and have it sync the metadata back into iCloud. Right now, if you edit the synced frontmatter fields, they will be overwritten on the next sync. 
- Incremental/automatic sync. I have fewer than 100 contacts in my iCloud, so doing a full sync every time doesn't take very long (less than a second?). That said, CardDAV supports doing fairly granular incremental syncs as well as being able to detect changes, so I could add a background process that polls for changes and automatically syncs.
