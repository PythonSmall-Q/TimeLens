#!/usr/bin/env python3
"""
Fix taskbar icon by removing the blue background and making it transparent.
This is specifically for the Square44x44Logo.png which is used in Windows taskbar.
"""

from PIL import Image
import os

def remove_blue_background_from_icon(input_path, output_path):
    """
    Removes the blue circular background from the icon and makes it transparent.
    The icon shows a clock on a blue background, we want to keep the clock with transparency.
    """
    # Open the image
    img = Image.open(input_path)
    
    # Convert to RGBA if not already
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # Get image data
    data = img.getdata()
    new_data = []
    
    # Define the color range for the dark blue background
    # The blue appears to be in the range of dark blue/navy
    # We'll look for colors that are clearly part of the blue background
    
    for item in data:
        # If pixel is part of the blue background (dark blue/navy color)
        # Check if it matches the blue tone (high blue, medium/low red/green)
        r, g, b = item[:3]
        
        # The blue background is roughly RGB(20-40, 40-80, 100-140)
        # We want to make these transparent while keeping the clock elements
        
        # More aggressive approach: if blue channel is significantly higher than red and green
        # and the overall brightness is not too high (to avoid removing clock details)
        if b > r + 20 and b > g + 20 and (r + g + b) < 300:
            # This is likely the blue background - make it transparent
            new_data.append((r, g, b, 0))  # Make transparent
        else:
            # Keep the pixel as is, but ensure it has full opacity for the clock
            if len(item) == 4:
                new_data.append((item[0], item[1], item[2], 255))
            else:
                new_data.append((*item[:3], 255))
    
    # Put the modified data back
    img.putdata(new_data)
    
    # Save the image
    img.save(output_path, 'PNG')
    print(f"✓ Created taskbar icon with transparent background: {output_path}")

def create_taskbar_icon_from_source(source_icon_path, output_dir):
    """
    Create a properly formatted taskbar icon from the source icon.
    """
    # For 44x44 taskbar icon (single scale factor)
    source_img = Image.open(source_icon_path)
    source_img = source_img.convert('RGBA')
    
    # Resize to 44x44
    img_44 = source_img.resize((44, 44), Image.Resampling.LANCZOS)
    
    # Remove blue background
    data = img_44.getdata()
    new_data = []
    
    for item in data:
        r, g, b = item[:3]
        
        # Remove blue background
        if b > r + 20 and b > g + 20 and (r + g + b) < 300:
            new_data.append((r, g, b, 0))
        else:
            new_data.append((item[0], item[1], item[2], 255))
    
    img_44.putdata(new_data)
    
    # Save the 44x44 version
    output_44_path = os.path.join(output_dir, 'Square44x44Logo.png')
    img_44.save(output_44_path, 'PNG')
    print(f"✓ Created {output_44_path}")
    
    # For high DPI (88x88 for 200%)
    img_88 = source_img.resize((88, 88), Image.Resampling.LANCZOS)
    data = img_88.getdata()
    new_data = []
    
    for item in data:
        r, g, b = item[:3]
        
        if b > r + 20 and b > g + 20 and (r + g + b) < 300:
            new_data.append((r, g, b, 0))
        else:
            new_data.append((item[0], item[1], item[2], 255))
    
    img_88.putdata(new_data)
    
    # Note: MSIX typically expects Square44x44Logo.png, but some systems may use high DPI versions
    # For now we'll create the main 44x44 version

def main():
    # Define paths
    workspace_root = r"c:\Users\seans\Documents\GitHub\TimeLens"
    source_icon = os.path.join(workspace_root, "src-tauri", "icons", "icon.png")
    output_dir = os.path.join(workspace_root, "src-tauri", "windows", "msix-staging", "Assets")
    output_icon = os.path.join(output_dir, "Square44x44Logo.png")
    
    # Verify paths exist
    if not os.path.exists(source_icon):
        print(f"Error: Source icon not found at {source_icon}")
        return False
    
    if not os.path.exists(output_dir):
        print(f"Error: Output directory not found at {output_dir}")
        return False
    
    print("Fixing Windows taskbar icon (Square44x44Logo.png)...")
    print(f"Source: {source_icon}")
    print(f"Output: {output_icon}")
    
    try:
        create_taskbar_icon_from_source(source_icon, output_dir)
        print("\n✓ Taskbar icon fixed successfully!")
        print("  The blue background has been removed and replaced with transparency.")
        print("  This will display correctly in the Windows taskbar.")
        return True
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    main()
