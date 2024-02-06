# Obsidian iCloud Contacts Sync plugin

> 🚀 **Read about how this was implemented**: [MAKING_OF.md](./MAKING_OF.md)

This plugin connects to your iCloud account via CardDAV and creates a note for each of your contacts. The plugin only edits frontmatter
and will not touch any details you add to the notes on subsequent syncs, including unsynced frontmatter fields.

The plugin will sync the following fields (frontmatter key name in parentheses):

- Name
- Organization
- Birthday
- Phone numbers (Phone)
- Email addresses (Emails)
- Address
- Note
- SyncID <- This represents the contact in iCloud and is used by the sync


## Installation

At this time, the plugin is only installable via [BRAT](https://tfthacker.com/BRAT).

- Install BRAT from the Community Plugins in Obsidian
- Open the command palette and run the command `BRAT: Add a beta plugin for testing`
- Copy `Schmavery/obsidian-icloud-contacts-sync` into the modal that opens up
- Click on Add Plugin -- wait a few seconds and BRAT will tell you what is going on
- After BRAT confirms the installation, in Settings go to the Community plugins tab.
- Refresh the list of plugins
- Find the beta plugin you just installed and Enable it.

## Usage

- Go to plugin settings and enter your iCloud username and password. **Use the instructions [here](https://support.apple.com/en-us/HT204397) to generate an app-specific password!**
- Optionally, customize the "People path", to put your contact notes in a different folder.
- Optionally, enable syncing of contacts without names. This is usually companies/organizations.

Then use the button in the sidebar or the `iCloud Contacts Sync: Sync All Contacts` command to run the sync.

## Future Work

- Support syncing back to iCloud
- Support incremental sync using ctag/etag. Right now every sync is a full sync.
- Submit to Obsidian plugin library

## Development

Instructions for making changes to this plugin:

- Clone to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/icloud-contacts-sync` folder.
- Make sure your NodeJS is at least v16 (`node --version`).
- Run `npm install` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin. (Or setup [hot-reload](https://github.com/pjeby/hot-reload))
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.
- To check for linting errors, run `npm run lint`.

### Extra Reading

- [Intro to Building a Plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [API Documentation](https://github.com/obsidianmd/obsidian-api)
- [Plugin Review](https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md)

## Releasing new releases

- Run `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
- This will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`, add a tag, and push.
- GitHub Actions will see the tag and build a release.
