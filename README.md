# Rust Drops Companion

Chrome extension that tracks Rust Twitch drops: claimed, live now (per streamer), unclaimed, and progress.

## Features

- Tracks Rust drops from twitch.facepunch.com
- Fallback to kick.facepunch.com when Twitch has no drops
- Shows live streamers and their status
- Tracks drop progress
- Auto-claim drops via API
- Notifications for live drops and ready-to-claim drops
- Dynamic theming: Purple for Twitch, Green for Kick

## Development

### Setup

```bash
npm install
```

### Available Scripts

- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run test` - Run tests
- `npm run build` - Build extension to `dist/` folder
- `npm run validate` - Run lint, format check, and tests

### Loading the Extension

1. Run `npm run build` to create the `dist` folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder

## Recent Improvements

### 1. Enhanced Drop Differentiation
- Added `dropInstanceID` matching for exact identification
- Added campaign ID differentiation
- Added image URL comparison
- Added streamer count differentiation
- Improved handling of same-name drops with different variants

### 2. Kick Integration
- Added kick.facepunch.com as fallback source
- Automatically switches to Kick when Twitch has no drops
- Tracks data source in scan results
- Dynamic UI theming based on source

### 3. Dynamic UI Theming
- CSS variables for easy theme switching
- Automatic theme updates based on drop source
- Smooth transitions between themes
- Purple theme for Twitch drops
- Green theme for Kick drops

### 4. Development Tooling
- Added ESLint for code quality
- Added Prettier for code formatting
- Added Jest for testing
- Added build script for extension packaging
- Added pre-commit validation script

### 5. Testing
- Added test suite for name matching logic
- Tests for normalization, tokenization, and fuzzy matching
- Easy to extend with more tests

## File Structure

```
twitch-rust/
├── manifest.json          # Chrome extension manifest
├── background.js          # Service worker (main logic)
├── popup.html             # Popup UI
├── popup.js               # Popup logic
├── content_*.js           # Content scripts for Twitch pages
├── beep.html/js           # Sound playback
├── icon*.png              # Extension icons
├── __tests__/             # Test files
├── scripts/               # Build scripts
├── package.json           # NPM configuration
├── .eslintrc.json         # ESLint configuration
├── .prettierrc.json       # Prettier configuration
└── jest.config.js         # Jest configuration
```

## License

Created by john503
