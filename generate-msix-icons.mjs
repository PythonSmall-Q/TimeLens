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
const workspaceRoot = __dirname;

const ICON_SPECS = [
    { name: 'Square44x44Logo.png', size: 44 },
    { name: 'Square71x71Logo.png', size: 71 },
    { name: 'Square150x150Logo.png', size: 150 },
    { name: 'Square310x310Logo.png', size: 310 },
    { name: 'Wide310x150Logo.png', width: 310, height: 150 },
    { name: 'StoreLogo.png', size: 50 }
];

const TASKBAR_TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 80, 96, 256];

async function processIcon(sourceIconPath, spec) {
    // Preserve original icon style; only resize on a transparent background.
    let image = sharp(sourceIconPath);
    
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
        
        console.log(`Source image: ${metadata.width}x${metadata.height}`);
        
        // Process each icon spec
        let successCount = 0;
        for (const spec of ICON_SPECS) {
            const outputPath = path.join(outputDir, spec.name);
            try {
                const processedImage = await processIcon(sourceIcon, spec);
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

        for (const size of TASKBAR_TARGET_SIZES) {
            const names = [
                `Square44x44Logo.targetsize-${size}.png`,
                `Square44x44Logo.altform-unplated_targetsize-${size}.png`
            ];

            for (const name of names) {
                const outputPath = path.join(outputDir, name);
                try {
                    await sharp(sourceIcon)
                        .resize(size, size, {
                            fit: 'inside',
                            background: { r: 0, g: 0, b: 0, alpha: 0 }
                        })
                        .png()
                        .toFile(outputPath);

                    console.log(`✓ ${name} (${size}x${size})`);
                    successCount++;
                } catch (err) {
                    console.error(`✗ ${name}: ${err.message}`);
                }
            }
        }
        
        const expectedCount = ICON_SPECS.length + (TASKBAR_TARGET_SIZES.length * 2);
        console.log(`\n✓ Successfully generated ${successCount}/${expectedCount} MSIX icons`);
        console.log('✓ Generated base and unplated targetsize icons with transparent backgrounds');
        console.log('\nThe taskbar and Start menu will display correctly without blue backgrounds.');
        
    } catch (error) {
        console.error(`✗ Error: ${error.message}`);
        process.exit(1);
    }
}

main();
