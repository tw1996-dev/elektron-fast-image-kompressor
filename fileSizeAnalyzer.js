/*
 * fileSizeAnalyzer.js - File Size Analysis Module
 * 
 * Handles:
 * - Measuring file sizes before compression
 * - Measuring file sizes after compression
 * - Calculating compression statistics and savings
 * - Formatting size data for display
 */

const fs = require('fs').promises;
const path = require('path');

class FileSizeAnalyzer {
    constructor() {
        this.inputStats = null;
        this.outputStats = null;
    }

    // Measure sizes of input files before compression
    async measureInputSizes(imageFiles) {
        console.log('=== MEASURING INPUT FILE SIZES ===');
        
        const inputData = {
            files: [],
            totalSize: 0,
            totalFiles: imageFiles.length
        };

        for (const imageFile of imageFiles) {
            try {
                const stats = await fs.stat(imageFile.fullPath);
                const fileData = {
                    name: imageFile.name,
                    path: imageFile.fullPath,
                    size: stats.size,
                    extension: imageFile.extension
                };
                
                inputData.files.push(fileData);
                inputData.totalSize += stats.size;
                
                console.log(`Input: ${imageFile.name} - ${this.formatBytes(stats.size)}`);
            } catch (error) {
                console.error(`Error measuring ${imageFile.name}:`, error.message);
                inputData.files.push({
                    name: imageFile.name,
                    path: imageFile.fullPath,
                    size: 0,
                    error: error.message
                });
            }
        }

        console.log(`Total input size: ${this.formatBytes(inputData.totalSize)}`);
        console.log('=====================================');

        this.inputStats = inputData;
        return inputData;
    }

    // Measure sizes of output files after compression
    async measureOutputSizes(outputPath, processingResults) {
        console.log('=== MEASURING OUTPUT FILE SIZES ===');
        
        const outputData = {
            files: [],
            totalSize: 0,
            totalFiles: 0,
            successfulFiles: 0
        };

        for (const result of processingResults) {
            if (!result.success) {
                outputData.files.push({
                    name: result.original,
                    size: 0,
                    error: result.error || 'Processing failed'
                });
                continue;
            }

            try {
                // Look for the compressed file
                let compressedFilePath;
                
                if (result.finalPath) {
                    // From sanitizer - has finalPath
                    compressedFilePath = result.finalPath;
                } else if (result.compressed) {
                    // From direct processing - has compressed filename
                    compressedFilePath = path.join(outputPath, result.compressed);
                } else {
                    // Fallback - construct path
                    const compressedName = path.basename(result.original, path.extname(result.original)) + '.webp';
                    compressedFilePath = path.join(outputPath, compressedName);
                }

                const stats = await fs.stat(compressedFilePath);
                const fileData = {
                    name: result.compressed || result.original,
                    originalName: result.original,
                    path: compressedFilePath,
                    size: stats.size
                };
                
                outputData.files.push(fileData);
                outputData.totalSize += stats.size;
                outputData.successfulFiles++;
                
                console.log(`Output: ${fileData.name} - ${this.formatBytes(stats.size)}`);
            } catch (error) {
                console.error(`Error measuring output for ${result.original}:`, error.message);
                outputData.files.push({
                    name: result.original,
                    size: 0,
                    error: error.message
                });
            }
        }

        outputData.totalFiles = outputData.files.length;
        console.log(`Total output size: ${this.formatBytes(outputData.totalSize)}`);
        console.log(`Successfully compressed: ${outputData.successfulFiles}/${outputData.totalFiles} files`);
        console.log('====================================');

        this.outputStats = outputData;
        return outputData;
    }

    // Calculate compression statistics
    calculateStats() {
        if (!this.inputStats || !this.outputStats) {
            throw new Error('Must measure both input and output sizes first');
        }

        const inputSize = this.inputStats.totalSize;
        const outputSize = this.outputStats.totalSize;
        const savings = inputSize - outputSize;
        const compressionRatio = inputSize > 0 ? (savings / inputSize) * 100 : 0;

        const stats = {
            inputSize: inputSize,
            outputSize: outputSize,
            savings: savings,
            compressionRatio: compressionRatio,
            inputFiles: this.inputStats.totalFiles,
            outputFiles: this.outputStats.successfulFiles,
            failedFiles: this.inputStats.totalFiles - this.outputStats.successfulFiles
        };

        console.log('=== COMPRESSION STATISTICS ===');
        console.log(`Original size: ${this.formatBytes(stats.inputSize)}`);
        console.log(`Compressed size: ${this.formatBytes(stats.outputSize)}`);
        console.log(`Space saved: ${this.formatBytes(stats.savings)} (${stats.compressionRatio.toFixed(1)}%)`);
        console.log(`Files processed: ${stats.outputFiles}/${stats.inputFiles}`);
        console.log('===============================');

        return stats;
    }

    // Format statistics for UI display
    formatStatsForUI(stats) {
        return {
            originalSize: this.formatBytes(stats.inputSize),
            compressedSize: this.formatBytes(stats.outputSize),
            spaceSaved: this.formatBytes(stats.savings),
            compressionPercent: stats.compressionRatio.toFixed(1) + '%',
            filesProcessed: `${stats.outputFiles}/${stats.inputFiles}`,
            summary: `Saved ${this.formatBytes(stats.savings)} (${stats.compressionRatio.toFixed(1)}%) from ${stats.inputFiles} files`
        };
    }

    // Format bytes to human readable format
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';

        const isNegative = bytes < 0;
        const absoluteBytes = Math.abs(bytes);
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(absoluteBytes) / Math.log(k));
        
        const size = parseFloat((absoluteBytes / Math.pow(k, i)).toFixed(2));
        const result = size + ' ' + sizes[i];
        
        return isNegative ? '-' + result : result;
    }

    // Get detailed file-by-file comparison
    getDetailedComparison() {
        if (!this.inputStats || !this.outputStats) {
            return null;
        }

        const comparison = [];
        
        // Create a map of output files by original name for quick lookup
        const outputMap = new Map();
        this.outputStats.files.forEach(file => {
            if (file.originalName) {
                outputMap.set(file.originalName, file);
            }
        });

        this.inputStats.files.forEach(inputFile => {
            const outputFile = outputMap.get(inputFile.name);
            
            if (outputFile && !outputFile.error) {
                const savings = inputFile.size - outputFile.size;
                const ratio = inputFile.size > 0 ? (savings / inputFile.size) * 100 : 0;
                
                comparison.push({
                    filename: inputFile.name,
                    originalSize: this.formatBytes(inputFile.size),
                    compressedSize: this.formatBytes(outputFile.size),
                    savings: this.formatBytes(savings),
                    ratio: ratio.toFixed(1) + '%',
                    success: true
                });
            } else {
                comparison.push({
                    filename: inputFile.name,
                    originalSize: this.formatBytes(inputFile.size),
                    compressedSize: 'Failed',
                    savings: '0 B',
                    ratio: '0%',
                    success: false,
                    error: outputFile?.error || 'Processing failed'
                });
            }
        });

        return comparison;
    }

    // Reset analyzer state
    reset() {
        this.inputStats = null;
        this.outputStats = null;
    }
}

module.exports = FileSizeAnalyzer;