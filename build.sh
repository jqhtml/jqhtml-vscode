#!/bin/bash

# JQHTML VS Code Extension Build Script

echo "Building JQHTML VS Code Extension..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Compile TypeScript
echo "Compiling TypeScript..."
npm run compile

# Check if vsce is installed
if ! command -v vsce &> /dev/null; then
    echo "Installing vsce (Visual Studio Code Extension manager)..."
    npm install -g vsce
fi

# Package the extension
echo "Packaging extension..."
vsce package

echo "Build complete! Extension packaged as jqhtml-*.vsix"
echo ""
echo "To install locally:"
echo "1. Open VS Code"
echo "2. Go to Extensions (Ctrl+Shift+X)"
echo "3. Click ... → Install from VSIX"
echo "4. Select the generated .vsix file"
echo ""
echo "To publish to marketplace:"
echo "vsce publish"