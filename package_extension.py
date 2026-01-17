
import os
import zipfile
import json

def package_extension():
    # Define the output zip filename
    # Read version from manifest
    try:
        with open('manifest.json', 'r', encoding='utf-8') as f:
            manifest = json.load(f)
            version = manifest.get('version', '1.0.0')
    except Exception as e:
        print(f"Could not read manifest version: {e}")
        version = 'unknown'

    zip_filename = f"xpath-helper-v{version}.zip"
    
    # Files and folders to include
    include_files = [
        'manifest.json',
        'background.js',
        'content.js',
        'popup.html',
        'popup.css',
        'popup.js',
        'styles.css'
    ]
    
    include_dirs = [
        'icons'
    ]
    
    print(f"Creating package: {zip_filename}...")
    
    try:
        with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add individual files
            for file in include_files:
                if os.path.exists(file):
                    zipf.write(file)
                    print(f"Added: {file}")
                else:
                    print(f"Warning: File not found: {file}")
            
            # Add directories
            for directory in include_dirs:
                if os.path.exists(directory):
                    for root, dirs, files in os.walk(directory):
                        for file in files:
                            file_path = os.path.join(root, file)
                            # Store in zip with relative path
                            zipf.write(file_path, file_path)
                            print(f"Added: {file_path}")
                else:
                    print(f"Warning: Directory not found: {directory}")
                    
        print(f"\nSuccess! Package created: {zip_filename}")
        
    except Exception as e:
        print(f"Error creating zip file: {e}")

if __name__ == "__main__":
    package_extension()
