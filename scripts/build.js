#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

// Create dist directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Files to copy
const filesToCopy = [
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.js',
  'content_auth.js',
  'content_inventory.js',
  'content_campaigns.js',
  'content_directory.js',
  'drop-filter.js',
  'beep.html',
  'beep.js',
  'icon16.png',
  'icon48.png',
  'icon128.png'
];

// Directories to exclude
const excludeDirs = ['tests', 'scripts', 'node_modules', 'coverage', '.git'];

// Copy files
filesToCopy.forEach(file => {
  const src = path.join(__dirname, '..', file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
  } else {
    console.warn(`Warning: ${file} not found`);
  }
});

console.log('\nBuild complete! Extension files are in the "dist" directory.');
console.log('Load "dist" as an unpacked extension in Chrome for testing.');
