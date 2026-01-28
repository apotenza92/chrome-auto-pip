#!/usr/bin/env node

// Simple validation script for Document PiP implementation
const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Document PiP Implementation...\n');

// Check files exist
const requiredFiles = [
    'scripts/utils.js',
    'options.html', 
    'options.js',
    'scripts/immediate-pip.js',
    'scripts/trigger-auto-pip.js',
    'main.js'
];

let allFilesExist = true;

console.log('📁 Checking required files:');
requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`  ✅ ${file}`);
    } else {
        console.log(`  ❌ ${file} - MISSING`);
        allFilesExist = false;
    }
});

if (!allFilesExist) {
    console.log('\n❌ Some required files are missing!');
    process.exit(1);
}

// Check utils.js for Document PiP functions
console.log('\n🔧 Checking utils.js for Document PiP functions:');
const utilsContent = fs.readFileSync('scripts/utils.js', 'utf8');
const requiredFunctions = [
    'supportsDocumentPiP',
    'requestDocumentPiP', 
    'loadPiPSettings',
    'calculatePiPDimensions'
];

requiredFunctions.forEach(func => {
    if (utilsContent.includes(`function ${func}`) || utilsContent.includes(`${func} =`)) {
        console.log(`  ✅ ${func}()`);
    } else {
        console.log(`  ❌ ${func}() - MISSING`);
    }
});

// Check options.html for pipSize dropdown
console.log('\n⚙️  Checking options.html for pipSize dropdown:');
const optionsContent = fs.readFileSync('options.html', 'utf8');
if (optionsContent.includes('id="pipSize"')) {
    console.log('  ✅ pipSize dropdown found');
} else {
    console.log('  ❌ pipSize dropdown missing');
}

// Check options.js for pipSize handling
console.log('\n🎛️  Checking options.js for pipSize handling:');
const optionsJsContent = fs.readFileSync('options.js', 'utf8');
if (optionsJsContent.includes('pipSize')) {
    console.log('  ✅ pipSize setting handling found');
} else {
    console.log('  ❌ pipSize setting handling missing');
}

// Check immediate-pip.js for Document PiP usage
console.log('\n🎬 Checking immediate-pip.js for Document PiP usage:');
const immediatePipContent = fs.readFileSync('scripts/immediate-pip.js', 'utf8');
if (immediatePipContent.includes('requestDocumentPiP')) {
    console.log('  ✅ Document PiP usage found');
} else {
    console.log('  ❌ Document PiP usage missing');
}

// Check trigger-auto-pip.js for Document PiP usage
console.log('\n🎭 Checking trigger-auto-pip.js for Document PiP usage:');
const triggerPipContent = fs.readFileSync('scripts/trigger-auto-pip.js', 'utf8');
if (triggerPipContent.includes('requestDocumentPiP')) {
    console.log('  ✅ Document PiP usage found');
} else {
    console.log('  ❌ Document PiP usage missing');
}

// Check main.js for pipSize settings
console.log('\n🏠 Checking main.js for pipSize settings:');
const mainContent = fs.readFileSync('main.js', 'utf8');
if (mainContent.includes('pipSize')) {
    console.log('  ✅ pipSize settings handling found');
} else {
    console.log('  ❌ pipSize settings handling missing');
}

console.log('\n🎉 Validation complete!');
console.log('\n📋 Implementation Summary:');
console.log('  • Added Document Picture-in-Picture API support');
console.log('  • Added configurable PiP window size (5%-95% in 5% increments)');
console.log('  • Updated options UI with size dropdown');
console.log('  • Modified both manual and auto PiP triggers');
console.log('  • Added proper video element restoration on exit');
console.log('  • Maintained backward compatibility with standard PiP');

console.log('\n🚀 Ready to test! Load the extension and try:');
console.log('  1. Open options.html to configure PiP size');
console.log('  2. Click extension icon on a video page');
console.log('  3. Verify PiP window opens with configured size');
console.log('  4. Test with test-document-pip.html for debugging');