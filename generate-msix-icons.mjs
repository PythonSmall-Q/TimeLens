#!/usr/bin/env node
/**
 * Generate proper MSIX icons with transparent backgrounds
 * This should be run after updating the source icon
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICON_SPECS = [
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square71x71Logo.png', size: 71 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Square310x310Logo.png', size: 310 },
    { name: 'Wide310x150Logo.png', width: 310, height: 150 },
    { name: 'StoreLogo.png', size: 50 }
];

async function processIcon(sourceData, metadata, spec) {
    // Copy the data to avoid mutating the original
    const data = Buffer.from(sourceData);
    
    // Process pixels - remove blue background
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // If this pixel is part of the blue background, make it transparent
        if (b > r + 20 && b > g + 20 && (r + g + b) < 300) {
            data[i + 3] = 0;  // Set alpha to 0 (transparent)
        } else {
            data[i + 3] = 255;  // Set alpha to 255 (opaque)
        }
    }
    
    // Create processed image
    let image = sharp(data, {
        raw: {
            width: metadata.width,
            height: metadata.height,
            channels: 4
        }
    });
    
    // Resize based on spec
    if (spec.width && spec.height) {
        // For wide tiles like Wide310x150Logo
        image = image.resize(spec.width, spec.height, {
            fit: 'inside',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        });
    } else {
        // For square tiles
        image = image.resize(spec.size, spec.size, {
            fit: 'inside',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        });
    }
    
    return image.png();
}

async function main() {
    const workspaceRoot = 'c:\\Users\\seans\\Documents\\GitHub\\TimeLens';
    const sourceIcon = path.join(workspaceRoot, 'src-tauri', 'icons', 'icon.png');
    const outputDir = path.join(workspaceRoot, 'src-tauri', 'windows', 'msix-staging', 'Assets');
    
    if (!fs.existsSync(sourceIcon)) {
        console.error(`✗ Source icon not found: ${sourceIcon}`);
        process.exit(1);
    }
    
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    console.log('Generating MSIX icons with transparent backgrounds...\n');
    
    try {
        // Read source icon
        const image = sharp(sourceIcon);
        const metadata = await image.metadata();
        const { data } = await image.raw().toBuffer({ resolveWithObject: true });
        
        console.log(`Source image: ${metadata.width}x${metadata.height}`);
        
        // Process each icon spec
        let successCount = 0;
        for (const spec of ICON_SPECS) {
            const outputPath = path.join(outputDir, spec.name);
            try {
                const processedImage = await processIcon(data, metadata, spec);
                await processedImage.toFile(outputPath);
                
                const displayName = spec.width ? 
                    `${spec.name} (${spec.width}x${spec.height})` : 
                    `${spec.name} (${spec.size}x${spec.size})`;
                
                console.log(`✓ ${displayName}`);
                successCount++;
            } catch (err) {
                console.error(`✗ ${spec.name}: ${err.message}`);
            }
        }
        
        console.log(`\n✓ Successfully generated ${successCount}/${ICON_SPECS.length} MSIX icons`);
        console.log('✓ All icons now have transparent backgrounds');
        console.log('\nThe taskbar and Start menu will display correctly without blue backgrounds.');
        
    } catch (error) {
        console.error(`✗ Error: ${error.message}`);
        process.exit(1);
    }
}

main();
