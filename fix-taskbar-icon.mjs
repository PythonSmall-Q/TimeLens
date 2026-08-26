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

async function fixTaskbarIcon() {
    // Check if sharp is available
    let sharp;
    try {
        sharp = (await import('sharp')).default;
    } catch (e) {
        console.error('sharp not found. Installing sharp...');
        const { execSync } = await import('child_process');
        try {
            execSync('npm install sharp', { stdio: 'inherit' });
            sharp = (await import('sharp')).default;
        } catch (err) {
            console.error('Failed to install sharp');
            process.exit(1);
        }
    }
    
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
        // Read image
        const image = sharp(sourceIcon);
        const metadata = await image.metadata();
        
        // Get raw pixel data
        const { data } = await image.raw().toBuffer({ resolveWithObject: true });
        
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
        
        // Resize to 44x44 with the processed pixels, then save
        await sharp({
            create: {
                width: metadata.width,
                height: metadata.height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
            .composite([{
                input: newData,
                raw: {
                    width: metadata.width,
                    height: metadata.height,
                    channels: 4
                }
            }])
            .resize(44, 44, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputIcon);
        
        console.log(`✓ Created ${outputIcon}`);
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
