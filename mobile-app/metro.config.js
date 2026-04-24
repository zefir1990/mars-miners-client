const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow Metro to resolve three.js ES module files
config.resolver.sourceExts.push('cjs', 'mjs');

// Add 3D asset extensions
config.resolver.assetExts.push('glb', 'gltf', 'obj', 'mtl');

module.exports = config;
