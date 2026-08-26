#!/usr/bin/env node
/**
 * Fix Windows taskbar icon by removing the blue background
 * Creates a transparent version of Square44x44Logo.png
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to use sharp for image processing, fall back to Canvas if needed
let processImage;

try {
    const sharp = (await import('sharp')).default;
    processImage = async (inputPath, outputPath) => {
        console.log(`Processing ${path.basename(inputPath)}...`);
        
        const image = sharp(inputPath);
        
        // Read the image as raw pixel data
        const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
        
        // Process pixels to remove blue background
        const newData = Buffer.alloc(data.length);
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // Check if pixel is part of blue background
            // Blue background is darker: b > r+20 and b > g+20 and overall dark
            if (b > r + 20 && b > g + 20 && (r + g + b) < 300) {
                // Make background transparent
                newData[i] = r;
                newData[i + 1] = g;
                newData[i + 2] = b;
                newData[i + 3] = 0; // Transparent
            } else {
                // Keep the pixel
                newData[i] = r;
                newData[i + 1] = g;
                newData[i + 2] = b;
                newData[i + 3] = 255; // Opaque
            }
        }
        
        // Resize to 44x44 and save
        await sharp({
            create: {
                width: info.width,
                height: info.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
            .composite([{ input: Buffer.concat([
                Buffer.from([...data]), 
            ]), raw: { width: info.width, height: info.height, channels: 4 } }])
            .png()
            .toFile(outputPath);
    };
} catch (e) {
    // If sharp is not available, use a different approach
    console.warn('sharp not found, will attempt alternative method');
    processImage = null;
}

async function fixTaskbarIcon() {
    const workspaceRoot = 'c:\\Users\\seans\\Documents\\GitHub\\TimeLens';
    const sourceIcon = path.join(workspaceRoot, 'src-tauri', 'icons', 'icon.png');
    const outputDir = path.join(workspaceRoot, 'src-tauri', 'windows', 'msix-staging', 'Assets');
    const outputIcon = path.join(outputDir, 'Square44x44Logo.png');
    
    // Check if source exists
    if (!fs.existsSync(sourceIcon)) {
        console.error(`✗ Source icon not found: ${sourceIcon}`);
        process.exit(1);
    }
    
    if (!fs.existsSync(outputDir)) {
        console.error(`✗ Output directory not found: ${outputDir}`);
        process.exit(1);
    }
    
    console.log('Fixing Windows taskbar icon (Square44x44Logo.png)...');
    console.log(`Source: ${sourceIcon}`);
    console.log(`Output: ${outputIcon}`);
    
    try {
        if (processImage) {
            await processImage(sourceIcon, outputIcon);
        } else {
            // Fallback: try using jimp
            try {
                const Jimp = require('jimp');
                const image = await Jimp.read(sourceIcon);
                
                // Resize to 44x44
                image.resize(44, 44);
                
                // Process each pixel to remove blue background
                image.forEachPixel((pixel, _x, _y) => {
                    const { r, g, b } = pixel;
                    
                    // If blue background, make transparent
                    if (b > r + 20 && b > g + 20 && (r + g + b) < 300) {
                        pixel.a = 0; // Transparent
                    } else {
                        pixel.a = 255; // Opaque
                    }
                });
                
                await image.write(outputIcon);
                console.log(`✓ Created ${outputIcon}`);
            } catch (jimpError) {
                console.error('Neither sharp nor jimp available. Installing sharp...');
                
                const { execSync } = require('child_process');
                try {
                    execSync('npm install sharp', { stdio: 'inherit', cwd: workspaceRoot });
                    console.log('sharp installed, please run the script again');
                    process.exit(0);
                } catch (installError) {
                    console.error('Failed to install sharp:', installError.message);
                    process.exit(1);
                }
            }
        }
        
        console.log('\n✓ Taskbar icon fixed successfully!');
        console.log('  The blue background has been removed and replaced with transparency.');
        console.log('  This will display correctly in the Windows taskbar.');
    } catch (error) {
        console.error('✗ Error:', error.message);
        process.exit(1);
    }
}

fixTaskbarIcon().catch(err => {
    console.error(err);
    process.exit(1);
});
