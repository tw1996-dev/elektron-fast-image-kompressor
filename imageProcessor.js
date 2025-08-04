/*
* imageProcessor.js - Sharp Sequential Image Compression Engine
* 
* Handles:
* - Sequential processing with Sharp (native C++ performance)
* - Memory-safe streaming processing
* - Smart progress updates with ETA calculation
* - Fallback sanitizer for problematic filenames
* - Multi-format support (JPG, PNG, GIF, SVG, TIFF, BMP) to WebP conversion
* - Maximum speed with Sharp's native optimization
* - Real cancellation support with cleanup
*/

const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const FileNameSanitizer = require('./fileNameSanitizer');
const FileSizeAnalyzer = require('./fileSizeAnalyzer');

class ImageProcessor {
   constructor() {
       this.supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.tiff', '.tif', '.bmp', '.webp'];
       this.isCancelled = false;
       this.progressCallback = null;
       this.sanitizer = new FileNameSanitizer();
       this.sizeAnalyzer = new FileSizeAnalyzer();
       
       // Pipeline optimization settings
       this.processingStartTime = null;
       this.processedCount = 0;
       this.avgProcessingTime = 0;
       
       // Cancellation tracking
       this.currentOutputPath = null;
       this.tempDirectories = [];
       
       // Sharp configuration
       this.initializeSharp();
   }

   // Initialize Sharp with optimal settings
   initializeSharp() {
       console.log('=== INITIALIZING SHARP ===');
       
       // Configure Sharp for maximum performance
       sharp.cache(false); // Disable cache for sequential processing
       sharp.concurrency(1); // Sequential processing
       sharp.simd(true); // Enable SIMD
       
       console.log('Sharp initialized with maximum speed settings');
   }

   // Get Sharp WebP settings optimized for speed and quality
   getWebPSettings(inputFormat, inputPath) {
       // Optimized for speed while maintaining quality
       const baseSettings = {
           quality: 75,
           effort: 1, // Fastest compression (was 4)
           alphaQuality: 75,
           lossless: false
       };

       // Simplified settings for maximum speed
       switch (inputFormat.toLowerCase()) {
           case '.png':
               return {
                   ...baseSettings,
                   quality: 80,
                   alphaQuality: 80,
                   effort: 1 // Fastest
               };
               
           case '.svg':
               return {
                   ...baseSettings,
                   lossless: true,
                   effort: 1 // Fastest even for lossless
               };
               
           default:
               return baseSettings;
       }
   }

   // Get progressive update interval based on file count
   getProgressInterval(totalFiles) {
       return 1; // Always update every file for real-time progress
   }

   // Helper method for formatBytes
   formatBytes(bytes) {
       if (bytes === 0) return '0 B';
       const k = 1024;
       const sizes = ['B', 'KB', 'MB', 'GB'];
       const i = Math.floor(Math.log(bytes) / Math.log(k));
       const size = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
       return size + ' ' + sizes[i];
   }

   // Scan folder recursively for image files
   async scanForImages(folderPath) {
       try {
           console.log('=== SCANNING FOLDER RECURSIVELY ===');
           const imageFiles = [];
           
           const scanRecursively = async (currentPath, depth = 0) => {
               // Check for cancellation during scan
               if (this.isCancelled) {
                   throw new Error('Scanning cancelled by user');
               }
               
               const files = await fs.readdir(currentPath, { withFileTypes: true });
               
               for (const file of files) {
                   if (this.isCancelled) {
                       throw new Error('Scanning cancelled by user');
                   }
                   
                   const fullPath = path.join(currentPath, file.name);
                   
                   if (file.isFile()) {
                       const ext = path.extname(file.name).toLowerCase();
                       
                       if (this.supportedFormats.includes(ext)) {
                           imageFiles.push({
                               name: file.name,
                               fullPath: fullPath,
                               extension: ext,
                               relativePath: path.relative(folderPath, fullPath)
                           });
                       }
                   } else if (file.isDirectory()) {
                       await scanRecursively(fullPath, depth + 1);
                   }
               }
           };
           
           await scanRecursively(folderPath);
           
           console.log(`Found ${imageFiles.length} image files`);
           return imageFiles;
       } catch (error) {
           if (this.isCancelled || error.message.includes('cancelled')) {
               throw new Error('Folder scanning was cancelled by user');
           }
           throw new Error(`Failed to scan folder: ${error.message}`);
       }
   }

   // Create output folder with smart naming
   async createOutputFolder(inputPath) {
       if (this.isCancelled) {
           throw new Error('Cancelled before creating output folder');
       }
       
       const inputStats = await fs.stat(inputPath);
       let outputPath;

       if (inputStats.isDirectory()) {
           const folderName = path.basename(inputPath);
           const parentDir = path.dirname(inputPath);
           outputPath = path.join(parentDir, `${folderName}_compressed`);
       } else {
           const parentDir = path.dirname(inputPath);
           outputPath = path.join(parentDir, 'compressed_images');
       }

       try {
           await fs.access(outputPath);
           const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
           outputPath = `${outputPath}_${timestamp}`;
       } catch {
           // Folder doesn't exist, which is good
       }

       await fs.mkdir(outputPath, { recursive: true });
       this.currentOutputPath = outputPath; // Store for cleanup
       return outputPath;
   }

   // Main processing method with Sharp sequential pipeline
   async processImages(inputPath, progressCallback = null) {
       this.progressCallback = progressCallback;
       this.isCancelled = false;
       this.processingStartTime = null;
       this.processedCount = 0;
       this.avgProcessingTime = 0;
       this.currentOutputPath = null;
       this.tempDirectories = [];

       try {
           // Scan for images
           this.updateProgress(0, 0, 0, 'Scanning for images...');
           const imageFiles = await this.scanForImages(inputPath);

           if (this.isCancelled) {
               throw new Error('Processing cancelled during scan');
           }

           if (imageFiles.length === 0) {
               throw new Error('No supported image files found in the selected folder. Supported formats: JPG, PNG, GIF, SVG, TIFF, BMP');
           }

           const progressInterval = this.getProgressInterval(imageFiles.length);

           console.log(`=== SHARP SEQUENTIAL PROCESSING ===`);
           console.log(`Files: ${imageFiles.length}, Progress interval: ${progressInterval}`);

           // Measure input file sizes
           this.updateProgress(0, imageFiles.length, 0, 'Measuring file sizes...');
           await this.sizeAnalyzer.measureInputSizes(imageFiles);

           if (this.isCancelled) {
               throw new Error('Processing cancelled during input measurement');
           }

           // Create output folder
           this.updateProgress(0, imageFiles.length, 0, 'Creating output folder...');
           const outputPath = await this.createOutputFolder(inputPath);

           if (this.isCancelled) {
               throw new Error('Processing cancelled during output folder creation');
           }

           // Process with Sharp sequential pipeline
           const results = await this.processSharpSequential(
               imageFiles, 
               outputPath, 
               progressInterval
           );

           if (this.isCancelled) {
               await this.performCleanup();
               throw new Error('Processing was cancelled by user');
           }

           // Calculate final stats
           const successfulFiles = results.filter(r => r.success).length;
           this.updateProgress(successfulFiles, imageFiles.length, 100, 'Calculating compression statistics...');
           await this.sizeAnalyzer.measureOutputSizes(outputPath, results);
           const compressionStats = this.sizeAnalyzer.calculateStats();
           const formattedStats = this.sizeAnalyzer.formatStatsForUI(compressionStats);

           console.log(`=== FINAL RESULTS ===`);
           console.log(`Successful: ${successfulFiles}/${imageFiles.length}`);

           return {
               success: true,
               processedFiles: successfulFiles,
               totalFiles: imageFiles.length,
               outputPath: outputPath,
               results: results,
               compressionStats: formattedStats
           };

       } catch (error) {
           this.sizeAnalyzer.reset();
           
           // Perform cleanup if cancelled
           if (this.isCancelled || error.message.includes('cancelled')) {
               await this.performCleanup();
           }
           
           throw new Error(`Image processing failed: ${error.message}`);
       }
   }

   // Sharp sequential processing - one file at a time with native performance
   async processSharpSequential(imageFiles, outputPath, progressInterval) {
       console.log(`=== SHARP SEQUENTIAL START ===`);
       
       const results = [];
       this.processingStartTime = Date.now();
       let lastProgressUpdate = 0;
       
       // Create temp directory for sanitized files (if needed)
       const tempDirName = this.sanitizer.getTempDirName();
       const tempDir = path.join(outputPath, '..', tempDirName);
       let tempDirCreated = false;

       for (let i = 0; i < imageFiles.length; i++) {
           // Check for cancellation at start of each iteration
           if (this.isCancelled) {
               console.log(`=== PROCESSING CANCELLED AT FILE ${i + 1}/${imageFiles.length} ===`);
               break;
           }
           
           const file = imageFiles[i];
           const fileStartTime = Date.now();
           
           try {
               // Double-check cancellation before processing each file
               if (this.isCancelled) {
                   console.log(`=== CANCELLATION DETECTED BEFORE PROCESSING ${file.name} ===`);
                   break;
               }
               
               // Check if output directory still exists (user might have deleted it)
               try {
                   await fs.access(outputPath);
               } catch {
                   throw new Error('Output folder was removed - processing cancelled');
               }
               
               let result;
               
               // Check if file needs sanitization
               if (this.needsSanitization(file.name)) {
                   // Create temp dir only when first needed
                   if (!tempDirCreated) {
                       await fs.mkdir(tempDir, { recursive: true });
                       tempDirCreated = true;
                       this.tempDirectories.push(tempDir);
                   }
                   
                   result = await this.processSharpSanitized(file, outputPath, tempDir);
               } else {
                   result = await this.processSharpClean(file, outputPath);
               }
               
               results.push(result);
               
               // Update processing time statistics
               const fileProcessTime = Date.now() - fileStartTime;
               this.updateProcessingStats(fileProcessTime);
               
               this.processedCount++;
               
               // Smart progress updates - update EVERY file for real-time feedback
               const currentProgress = (this.processedCount / imageFiles.length) * 100;
               const etaMessage = this.calculateETA(imageFiles.length);
               
               this.updateProgress(
                   this.processedCount,
                   imageFiles.length,
                   currentProgress,
                   `${file.name}${etaMessage}`
               );
               console.log(`[${this.processedCount}/${imageFiles.length}] Processed: ${file.name}`);
               
           } catch (error) {
               // Check if error is due to cancellation
               if (this.isCancelled || error.message.includes('cancelled')) {
                   console.log(`=== PROCESSING CANCELLED DURING ${file.name} ===`);
                   break;
               }
               
               console.error(`Error processing ${file.name}:`, error.message);
               results.push({
                   original: file.name,
                   error: error.message,
                   success: false
               });
               this.processedCount++;
           }
       }
       
       // Cleanup temp directory if it was created
       if (tempDirCreated && !this.isCancelled) {
           try {
               await fs.rm(tempDir, { recursive: true, force: true });
               this.tempDirectories = this.tempDirectories.filter(dir => dir !== tempDir);
           } catch (error) {
               console.warn('Failed to cleanup temp directory:', error.message);
           }
       }
       
       console.log(`=== SHARP SEQUENTIAL COMPLETE ===`);
       return results;
   }

   // Check if filename needs sanitization
   needsSanitization(filename) {
       return /[^\w\s\-_.()[\]]/g.test(filename);
   }

   // Process a clean file with Sharp (no problematic characters)
   async processSharpClean(file, outputPath) {
       try {
           // Check cancellation before processing
           if (this.isCancelled) {
               throw new Error('Processing cancelled before Sharp processing');
           }
           
           const outputBaseName = path.basename(file.name, path.extname(file.name));
           const outputFileName = outputBaseName + '.webp';
           const outputFilePath = path.join(outputPath, outputFileName);
           
           // Get Sharp WebP settings for this file type
           const webpSettings = this.getWebPSettings(file.extension, file.fullPath);
           
           // Process with Sharp - streaming for memory efficiency
           await sharp(file.fullPath)
               .webp(webpSettings)
               .toFile(outputFilePath);
           
           // Final cancellation check after processing
           if (this.isCancelled) {
               // Clean up the file we just created
               try {
                   await fs.unlink(outputFilePath);
               } catch (e) {
                   // Ignore cleanup errors
               }
               throw new Error('Processing cancelled after Sharp processing');
           }
           
           return {
               original: file.name,
               compressed: outputFileName,
               success: true,
               finalPath: outputFilePath
           };
           
       } catch (error) {
           // Check if cancellation error
           if (this.isCancelled || error.message.includes('cancelled')) {
               throw error;
           }
           
           // Handle specific Sharp errors
           if (error.message.includes('Input file is missing')) {
               throw new Error(`File not found: ${file.name}`);
           } else if (error.message.includes('Input file contains unsupported image format')) {
               throw new Error(`Unsupported format in ${file.name}`);
           } else if (error.message.includes('Input image exceeds pixel limit')) {
               throw new Error(`Image too large: ${file.name}`);
           } else {
               throw new Error(`Sharp processing failed for ${file.name}: ${error.message}`);
           }
       }
   }

   // Process a file that needs sanitization with Sharp
   async processSharpSanitized(file, outputPath, tempDir) {
       try {
           // Check cancellation before processing
           if (this.isCancelled) {
               throw new Error('Processing cancelled before sanitized Sharp processing');
           }
           
           // Create sanitized temp file
           const sanitizedName = this.sanitizer.sanitizeFileName(file.name);
           const tempPath = path.join(tempDir, sanitizedName);
           
           // Copy to temp location with sanitized name
           await fs.copyFile(file.fullPath, tempPath);
           
           // Process the sanitized file with Sharp
           const originalBaseName = path.basename(file.name, path.extname(file.name));
           const finalName = originalBaseName + '.webp';
           const finalPath = path.join(outputPath, finalName);
           
           // Get Sharp WebP settings for this file type
           const webpSettings = this.getWebPSettings(file.extension, tempPath);
           
           // Process with Sharp
           await sharp(tempPath)
               .webp(webpSettings)
               .toFile(finalPath);
           
           // Clean up temp file immediately
           try {
               await fs.unlink(tempPath);
           } catch (e) {
               // Ignore cleanup errors
           }
           
           // Final cancellation check after processing
           if (this.isCancelled) {
               // Clean up the final file we just created
               try {
                   await fs.unlink(finalPath);
               } catch (e) {
                   // Ignore cleanup errors
               }
               throw new Error('Processing cancelled after sanitized Sharp processing');
           }
           
           return {
               original: file.name,
               compressed: finalName,
               success: true,
               finalPath: finalPath
           };
           
       } catch (error) {
           // Check if cancellation error
           if (this.isCancelled || error.message.includes('cancelled')) {
               throw error;
           }
           
           throw new Error(`Sharp sanitized processing failed for ${file.name}: ${error.message}`);
       }
   }

   // Update processing time statistics for ETA calculation
   updateProcessingStats(processingTime) {
       if (this.processedCount === 0) {
           this.avgProcessingTime = processingTime;
       } else {
           // Rolling average with more weight on recent files
           this.avgProcessingTime = (this.avgProcessingTime * 0.7) + (processingTime * 0.3);
       }
   }

   // Calculate ETA based on processing statistics
   calculateETA(totalFiles) {
       if (this.processedCount === 0 || !this.processingStartTime || this.isCancelled) {
           return ' • calculating time...';
       }
       
       const remainingFiles = totalFiles - this.processedCount;
       if (remainingFiles <= 0) {
           return ' • finishing...';
       }
       
       // Use average processing time for ETA
       const estimatedMs = remainingFiles * this.avgProcessingTime;
       const estimatedSeconds = Math.ceil(estimatedMs / 1000);
       
       if (estimatedSeconds > 60) {
           const minutes = Math.ceil(estimatedSeconds / 60);
           return ` • ~${minutes}min remaining`;
       } else if (estimatedSeconds > 5) {
           return ` • ~${estimatedSeconds}s remaining`;
       } else {
           return ' • almost done...';
       }
   }

   // Update progress with throttling
   updateProgress(current, total, percent, message) {
       if (this.progressCallback && !this.isCancelled) {
           this.progressCallback({
               current: current,
               total: total,
               percent: percent,
               message: message
           });
       }
   }

   // Perform cleanup on cancellation
   async performCleanup() {
       console.log('=== PERFORMING CANCELLATION CLEANUP ===');
       
       try {
           // Clean up temp directories
           for (const tempDir of this.tempDirectories) {
               try {
                   await fs.rm(tempDir, { recursive: true, force: true });
                   console.log(`Cleaned up temp directory: ${tempDir}`);
               } catch (error) {
                   console.warn(`Failed to cleanup temp directory ${tempDir}:`, error.message);
               }
           }
           
           // Optionally clean up output directory if no files were successfully processed
           if (this.currentOutputPath && this.processedCount === 0) {
               try {
                   await fs.rm(this.currentOutputPath, { recursive: true, force: true });
                   console.log(`Cleaned up empty output directory: ${this.currentOutputPath}`);
               } catch (error) {
                   console.warn(`Failed to cleanup output directory:`, error.message);
               }
           }
           
       } catch (error) {
           console.error('Error during cleanup:', error);
       }
       
       console.log('=== CLEANUP COMPLETE ===');
   }

   // Cancel processing
   async cancel() {
       console.log('=== CANCELLATION INITIATED ===');
       this.isCancelled = true;
       
       // Perform immediate cleanup
       await this.performCleanup();
       
       console.log('=== CANCELLATION COMPLETE ===');
   }
}

module.exports = ImageProcessor;