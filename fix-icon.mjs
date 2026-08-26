#!/usr/bin/env node
/**
 * Fix Windows taskbar icon by removing the blue background
 */

import sharp from 'sharp';
import path from 'path';

async function main() {
    const workspaceRoot = 'c:\\Users\\seans\\Documents\\GitHub\\TimeLens';
    const sourceIcon = path.join(workspaceRoot, 'src-tauri', 'icons', 'icon.png');
    const outputDir = path.join(workspaceRoot, 'src-tauri', 'windows', 'msix-staging', 'Assets');
    const outputIcon = path.join(outputDir, 'Square44x44Logo.png');
    
    console.log('Fixing Windows taskbar icon...');
    console.log(`Source: ${sourceIcon}`);
    console.log(`Output: ${outputIcon}`);
    
    try {
        // Read the source image
        const image = sharp(sourceIcon);
        const metadata = await image.metadata();
        
        console.log(`Image size: ${metadata.width}x${metadata.height}`);
        
        // Get raw pixel data
        const { data } = await image.raw().toBuffer({ resolveWithObject: true });
        
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
        
        // Create a new image from the processed pixel data and resize
        await sharp(data, {
            raw: {
                width: metadata.width,
                height: metadata.height,
                channels: 4
            }
        })
            .resize(44, 44, {
                fit: 'inside',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputIcon);
        
        console.log(`\n✓ Successfully created taskbar icon: ${outputIcon}`);
        console.log('✓ Blue background has been removed');
        console.log('✓ Icon now has a transparent background');
        console.log('\nThe taskbar icon will now display correctly in Windows without the blue background.');
        
    } catch (error) {
        console.error(`✗ Error: ${error.message}`);
        process.exit(1);
    }
}

main();
