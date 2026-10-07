# Rust Drops Companion

A Chrome extension for keeping track of Rust Twitch Drops, campaign progress, and live streamers.

> **Experimental project:** This extension was built primarily as an experiment in AI coding agents and
> vibe coding. The author does not have a JavaScript background, and roughly 90% of the project was
> AI-assisted. It is shared openly for people who want to try it, test it, or make improvements.

## Features

- View claimed and unclaimed drops and track drop progress.
- See live streamers associated with drops.
- Refresh Rust Drops data from the Facepunch campaign pages.
- Receive notifications for live drops and drops ready to claim.
- Switch between Twitch and Kick data sources, with source-specific colors.

## Testing status

- **Twitch:** The integration was tested and worked well during Round 53, the **Rust Isles** campaign.
  Twitch and Facepunch can change their pages or APIs, so this does not guarantee that it will keep
  working in future campaigns.
- **Kick:** The integration is present but has not been tested.
- **Advanced Settings and Accounts tabs:** These features have not been fully tested.
- The automated tests cover drop filtering and name matching; they do not verify live service
  integrations.

Use the extension as an experimental project, and check that it behaves as expected before relying on
it.

## Install for testing

### Requirements

- Google Chrome
- Node.js 18 or later and npm

### Build and load

1. Clone or download this repository.
2. In a terminal opened in the project folder, install the development dependencies and build:

   ```bash
   npm install
   npm run build
   ```

3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Select **Load unpacked** and choose the generated `dist` folder.

To run the automated tests, use:

```bash
npm test
```

Other project checks are available with `npm run lint`, `npm run format:check`, and `npm run validate`.

## Development

The extension uses the Chrome Extension Manifest V3. Its main runtime files are in the repository
root; `scripts/build.js` copies the files needed by the extension into `dist/`. The `tests/` folder
contains the automated tests.

Contributions, testing, bug reports, and improvements are welcome. Feel free to fork the project and
adapt it; please share what you tested and on which campaign or data source when reporting results.

## License

This project is licensed under the [MIT License](./LICENSE).

**Created by:** [john503](https://github.com/Oajohn)
