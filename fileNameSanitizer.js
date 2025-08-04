/*
 * fileNameSanitizer.js - File Name Sanitization Utility
 * 
 * Handles:
 * - Sanitizing file names for safe processing
 * - Preserving original names for output
 * - Unicode character handling
 * - Special character replacement
 * - File extension preservation
 */

const path = require('path');
const fs = require('fs').promises;

class FileNameSanitizer {
    constructor() {
        // Characters that cause problems in file processing
        this.problematicChars = /[^\w\s\-_.()[\]]/g;
        this.multipleSpaces = /\s+/g;
        this.tempFileMap = new Map(); // Map original -> temp -> final
    }

    // Sanitize filename for safe processing
    sanitizeFileName(originalName) {
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);
        
        // Replace problematic characters with safe alternatives
        let sanitized = baseName
            .replace(this.problematicChars, '_') // Replace special chars with underscore
            .replace(this.multipleSpaces, '_')   // Replace multiple spaces with single underscore
            .substring(0, 100);                  // Limit length to 100 chars
        
        // Ensure it doesn't start or end with underscore
        sanitized = sanitized.replace(/^_+|_+$/g, '');
        
        // If sanitized name is empty, use fallback
        if (!sanitized) {
            sanitized = 'sanitized_file';
        }
        
        return sanitized + ext;
    }

    // Create temporary files with sanitized names
    async createTempFiles(imageFiles, tempDir) {
        const tempFiles = [];
        
        await fs.mkdir(tempDir, { recursive: true });
        
        for (const imageFile of imageFiles) {
            const sanitizedName = this.sanitizeFileName(imageFile.name);
            const tempPath = path.join(tempDir, sanitizedName);
            
            // Copy original file to temp location with sanitized name
            await fs.copyFile(imageFile.fullPath, tempPath);
            
            const tempFile = {
                originalName: imageFile.name,
                originalPath: imageFile.fullPath,
                sanitizedName: sanitizedName,
                tempPath: tempPath,
                extension: imageFile.extension
            };
            
            tempFiles.push(tempFile);
            
            // Store mapping for later cleanup
            this.tempFileMap.set(tempPath, {
                original: imageFile.fullPath,
                originalName: imageFile.name
            });
        }
        
        console.log('Created temp files:', tempFiles.map(f => ({
            original: f.originalName,
            sanitized: f.sanitizedName
        })));
        
        return tempFiles;
    }

    // Restore original names after processing
    async restoreOriginalNames(processedFiles, outputDir) {
        const restoredFiles = [];
        
        console.log('=== SANITIZER RESTORE DEBUG ===');
        console.log('processedFiles:', processedFiles);
        console.log('tempFileMap:', Array.from(this.tempFileMap.entries()));
        
        for (const file of processedFiles) {
            console.log('Processing file:', file);
            
            // Normalize path separators for comparison
            const normalizedSourcePath = file.sourcePath.replace(/\//g, '\\');
            console.log('Normalized sourcePath:', normalizedSourcePath);
            const tempInfo = this.tempFileMap.get(normalizedSourcePath);
            console.log('tempInfo for', file.sourcePath, ':', tempInfo);
            
            if (!tempInfo) {
                console.log('No tempInfo found - this should not happen!');
                restoredFiles.push({
                    original: 'unknown',
                    error: 'No mapping found',
                    success: false
                });
                continue;
            }
            
            const originalBaseName = path.basename(tempInfo.originalName, path.extname(tempInfo.originalName));
            const newFileName = originalBaseName + '.webp';
            const newPath = path.join(outputDir, newFileName);
            
            try {
                // Rename processed file to original name with .webp extension
                await fs.rename(file.destinationPath, newPath);
                
                restoredFiles.push({
                    original: tempInfo.originalName,
                    compressed: newFileName,
                    success: true,
                    finalPath: newPath
                });
            } catch (error) {
                console.error(`Error restoring name for ${file.destinationPath}:`, error.message);
                restoredFiles.push({
                    original: tempInfo.originalName,
                    error: error.message,
                    success: false
                });
            }
        }
        
        return restoredFiles;
    }

    // Clean up temporary files and directory
    async cleanup(tempDir) {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
            this.tempFileMap.clear();
            console.log('Temp directory cleaned up:', tempDir);
        } catch (error) {
            console.error('Error cleaning up temp directory:', error.message);
        }
    }

    // Generate unique temp directory name
    getTempDirName() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        return `temp_imagemin_${timestamp}_${Math.random().toString(36).substring(7)}`;
    }
}

module.exports = FileNameSanitizer;