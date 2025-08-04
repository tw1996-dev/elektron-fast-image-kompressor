/*
* imageProcessor.js - Image Compression Engine
* 
* Handles:
* - Batch processing of images with auto-detect memory optimization
* - Multi-format support (JPG, PNG, GIF, SVG, TIFF, BMP) to WebP conversion
* - Smart output folder naming and creation
* - Progress tracking and error handling
* - Memory-efficient chunked processing for thousands of files
* - File size analysis and compression statistics
*/

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const FileNameSanitizer = require('./fileNameSanitizer');
const FileSizeAnalyzer = require('./fileSizeAnalyzer');

class ImageProcessor {
   constructor() {
       this.supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.tiff', '.tif', '.bmp', '.webp'];
       this.isCancelled = false;
       this.progressCallback = null;
       this.imagemin = null;
       this.plugins = null;
       this.sanitizer = new FileNameSanitizer();
       this.sizeAnalyzer = new FileSizeAnalyzer();
   }

   // Dynamic import of ES modules
   async initializeImagemin() {
       if (this.imagemin) return; // Already initialized

       try {
           console.log('=== INITIALIZING IMAGEMIN MODULES ===');
           // Dynamic imports for ES modules
           const imageminModule = await import('imagemin');
           console.log('Imagemin module loaded');
           
           const imageminWebpModule = await import('imagemin-webp');
           console.log('WebP plugin loaded');
           
           const imageminMozjpegModule = await import('imagemin-mozjpeg');
           console.log('MozJPEG plugin loaded');
           
           const imageminPngquantModule = await import('imagemin-pngquant');
           console.log('PNGQuant plugin loaded');
           
           const imageminGifsicleModule = await import('imagemin-gifsicle');
           console.log('Gifsicle plugin loaded');
           
           const imageminSvgoModule = await import('imagemin-svgo');
           console.log('SVGO plugin loaded');

           this.imagemin = imageminModule.default;
           
           this.plugins = [
               imageminWebpModule.default({ 
                   quality: 75,
                   method: 6,
                   alphaQuality: 75
               }),
               imageminMozjpegModule.default({ quality: 85 }),
               imageminPngquantModule.default({ quality: [0.6, 0.8] }),
               imageminGifsicleModule.default({ optimizationLevel: 3 }),
               imageminSvgoModule.default({
                   plugins: [
                       { name: 'removeViewBox', active: false }
                   ]
               })
           ];
           
           console.log('All imagemin modules initialized successfully');
           console.log('========================================');
       } catch (error) {
           console.error('Failed to initialize imagemin:', error);
           throw new Error(`Failed to initialize imagemin: ${error.message}`);
       }
   }

   // Auto-detect optimal chunk size based on available memory
   getOptimalChunkSize() {
       const totalMemory = os.totalmem();
       const freeMemory = os.freemem();
       const availableMemory = Math.min(totalMemory * 0.3, freeMemory * 0.5); // Use 30% of total or 50% of free
       
       // Estimate ~10MB per image processing
       const estimatedMemoryPerImage = 10 * 1024 * 1024;
       const optimalChunkSize = Math.floor(availableMemory / estimatedMemoryPerImage);
       
       // Clamp between 10 and 100 images per chunk
       return Math.max(10, Math.min(100, optimalChunkSize));
   }

   // Scan folder recursively for image files
   async scanForImages(folderPath) {
       try {
           console.log('=== SCANNING FOLDER RECURSIVELY ===');
           console.log('Root folder:', folderPath);
           
           const imageFiles = [];
           
           // Rekursywna funkcja do skanowania folderów
           const scanRecursively = async (currentPath, depth = 0) => {
               console.log(`${'  '.repeat(depth)}Scanning: ${currentPath}`);
               
               const files = await fs.readdir(currentPath, { withFileTypes: true });
               
               for (const file of files) {
                   const fullPath = path.join(currentPath, file.name);
                   
                   if (file.isFile()) {
                       const ext = path.extname(file.name).toLowerCase();
                       console.log(`${'  '.repeat(depth + 1)}File: ${file.name}, Extension: ${ext}, Supported: ${this.supportedFormats.includes(ext)}`);
                       
                       if (this.supportedFormats.includes(ext)) {
                           imageFiles.push({
                               name: file.name,
                               fullPath: fullPath,
                               extension: ext,
                               relativePath: path.relative(folderPath, fullPath)
                           });
                       }
                   } else if (file.isDirectory()) {
                       console.log(`${'  '.repeat(depth + 1)}Folder: ${file.name} - scanning recursively...`);
                       // Rekursywnie skanuj podfolder
                       await scanRecursively(fullPath, depth + 1);
                   }
               }
           };
           
           // Rozpocznij skanowanie od głównego folderu
           await scanRecursively(folderPath);
           
           console.log('=== SCAN COMPLETE ===');
           console.log('Total image files found:', imageFiles.length);
           console.log('Image files details:', imageFiles.map(f => ({
               name: f.name,
               path: f.relativePath
           })));
           console.log('======================');

           return imageFiles;
       } catch (error) {
           throw new Error(`Failed to scan folder: ${error.message}`);
       }
   }

   // Create output folder with smart naming
   async createOutputFolder(inputPath) {
       const inputStats = await fs.stat(inputPath);
       let outputPath;

       if (inputStats.isDirectory()) {
           // Folder input: add "_compressed" suffix
           const folderName = path.basename(inputPath);
           const parentDir = path.dirname(inputPath);
           outputPath = path.join(parentDir, `${folderName}_compressed`);
       } else {
           // File input: create "compressed_images" folder in same directory
           const parentDir = path.dirname(inputPath);
           outputPath = path.join(parentDir, 'compressed_images');
       }

       try {
           await fs.access(outputPath);
           // If folder exists, add timestamp
           const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
           outputPath = `${outputPath}_${timestamp}`;
       } catch {
           // Folder doesn't exist, which is good
       }

       await fs.mkdir(outputPath, { recursive: true });
       return outputPath;
   }

   // Process images in chunks
   async processImages(inputPath, progressCallback = null) {
       this.progressCallback = progressCallback;
       this.isCancelled = false;

       try {
           // Initialize imagemin modules
           this.updateProgress(0, 0, 0, 'Initializing compression modules...');
           await this.initializeImagemin();

           // Scan for images
           this.updateProgress(0, 0, 0, 'Scanning for images...');
           const imageFiles = await this.scanForImages(inputPath);

           if (imageFiles.length === 0) {
               throw new Error('No supported image files found in the selected folder. Supported formats: JPG, PNG, GIF, SVG, TIFF, BMP');
           }

           // Measure input file sizes
           this.updateProgress(0, imageFiles.length, 0, 'Measuring file sizes...');
           await this.sizeAnalyzer.measureInputSizes(imageFiles);

           // Create output folder
           this.updateProgress(0, imageFiles.length, 0, 'Creating output folder...');
           const outputPath = await this.createOutputFolder(inputPath);

           // Process in chunks
           const chunkSize = this.getOptimalChunkSize();
           const totalFiles = imageFiles.length;
           let processedFiles = 0;
           const results = [];

           console.log(`Processing ${totalFiles} images in chunks of ${chunkSize}`);

           for (let i = 0; i < imageFiles.length; i += chunkSize) {
               if (this.isCancelled) break;

               const chunk = imageFiles.slice(i, i + chunkSize);
               const chunkNum = Math.floor(i / chunkSize) + 1;
               const totalChunks = Math.ceil(imageFiles.length / chunkSize);

               this.updateProgress(
                   processedFiles, 
                   totalFiles, 
                   (processedFiles / totalFiles) * 100,
                   `Processing chunk ${chunkNum}/${totalChunks}...`
               );

               try {
                   const chunkResults = await this.processChunk(chunk, outputPath, processedFiles, totalFiles);
                   results.push(...chunkResults);
                   processedFiles += chunk.length;

                   this.updateProgress(
                       processedFiles, 
                       totalFiles, 
                       (processedFiles / totalFiles) * 100,
                       `Completed ${processedFiles}/${totalFiles} images`
                   );
               } catch (error) {
                   console.error(`Error processing chunk ${chunkNum}:`, error);
                   // Continue with next chunk instead of failing completely
               }
           }

           if (this.isCancelled) {
               throw new Error('Processing was cancelled by user');
           }

           // Measure output file sizes and calculate stats
           this.updateProgress(processedFiles, totalFiles, 100, 'Calculating compression statistics...');
           await this.sizeAnalyzer.measureOutputSizes(outputPath, results);
           const compressionStats = this.sizeAnalyzer.calculateStats();
           const formattedStats = this.sizeAnalyzer.formatStatsForUI(compressionStats);

           // Count successful results
           const successfulFiles = results.filter(r => r.success).length;
           console.log(`=== FINAL RESULTS ===`);
           console.log(`Total results: ${results.length}`);
           console.log(`Successful: ${successfulFiles}`);
           console.log(`Results details:`, results.map(r => ({ original: r.original, success: r.success })));
           console.log(`==================`);

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
           throw new Error(`Image processing failed: ${error.message}`);
       }
   }

   // Process a single chunk of images
   async processChunk(imageFiles, outputPath, currentOffset = 0, totalFiles = 0) {
       console.log(`Processing chunk: ${imageFiles.length} files`);
       
       await this.initializeImagemin(); // Ensure imagemin is loaded

       // Try direct processing first (without sanitizer)
       const inputPaths = imageFiles.map(file => file.fullPath);

       try {
           console.log('Attempting direct processing...');
           const files = await this.imagemin(inputPaths, {
               destination: outputPath,
               plugins: this.plugins
           });
           
           console.log(`Direct processing result: ${files.length}/${imageFiles.length} files`);

           // Check if some files were skipped (problematic names)
           if (files.length < imageFiles.length) {
               console.log('Some files were skipped - processing individually...');
               return await this.processIndividually(imageFiles, outputPath, currentOffset, totalFiles);
           }

           // All files processed successfully - direct rename
           const renamePromises = files.map(async (file, index) => {
               const oldPath = file.destinationPath;
               const newPath = oldPath.replace(/\.(jpe?g|png|gif|svg|tiff?|bmp|webp)$/i, '.webp');

               // Update progress for each file
               const currentFileIndex = currentOffset + index + 1;
               this.updateProgress(
                   currentFileIndex, 
                   totalFiles, 
                   (currentFileIndex / totalFiles) * 100,
                   `Processing: ${path.basename(file.sourcePath)}`
               );

               if (oldPath !== newPath) {
                   try {
                       await fs.rename(oldPath, newPath);
                       return {
                           original: path.basename(file.sourcePath),
                           compressed: path.basename(newPath),
                           success: true
                       };
                   } catch (error) {
                       return {
                           original: path.basename(file.sourcePath),
                           error: error.message,
                           success: false
                       };
                   }
               }
               return {
                   original: path.basename(file.sourcePath),
                   compressed: path.basename(oldPath),
                   success: true
               };
           });

           return await Promise.all(renamePromises);
           
       } catch (error) {
           // Direct processing failed - try individually
           console.log('Direct processing failed, processing individually...');
           return await this.processIndividually(imageFiles, outputPath, currentOffset, totalFiles);
       }
   }

   // Process files individually - only problematic ones get sanitized
   async processIndividually(imageFiles, outputPath, currentOffset = 0, totalFiles = 0) {
       console.log('=== PROCESSING INDIVIDUALLY ===');
       const results = [];
       
       for (let i = 0; i < imageFiles.length; i++) {
           const imageFile = imageFiles[i];
           const currentFileIndex = currentOffset + i + 1;
           
           // Update progress for each individual file
           this.updateProgress(
               currentFileIndex, 
               totalFiles || imageFiles.length, 
               (currentFileIndex / (totalFiles || imageFiles.length)) * 100,
               `Processing: ${imageFile.name}`
           );

           try {
               // Try direct processing for single file
               const files = await this.imagemin([imageFile.fullPath], {
                   destination: outputPath,
                   plugins: this.plugins
               });
               
               if (files.length > 0) {
                   // Success - direct rename
                   const file = files[0];
                   const oldPath = file.destinationPath;
                   const newPath = oldPath.replace(/\.(jpe?g|png|gif|svg|tiff?|bmp|webp)$/i, '.webp');

                   if (oldPath !== newPath) {
                       await fs.rename(oldPath, newPath);
                   }
                   
                   results.push({
                       original: imageFile.name,
                       compressed: path.basename(newPath),
                       success: true
                   });
                   console.log(`✓ Direct: ${imageFile.name}`);
               } else {
                   // File skipped - use sanitizer for this one file
                   console.log(`⚠ Sanitizing: ${imageFile.name}`);
                   
                   // Inline sanitizer for single file
                   const tempDirName = this.sanitizer.getTempDirName();
                   const tempDir = path.join(outputPath, '..', tempDirName);
                   
                   try {
                       const tempFiles = await this.sanitizer.createTempFiles([imageFile], tempDir);
                       const inputPaths = tempFiles.map(file => file.tempPath);

                       const sanitizedFiles = await this.imagemin(inputPaths, {
                           destination: outputPath,
                           plugins: this.plugins
                       });
                       
                       if (sanitizedFiles.length > 0) {
                           const restoredFiles = await this.sanitizer.restoreOriginalNames(sanitizedFiles, outputPath);
                           results.push(...restoredFiles);
                           console.log(`✓ Sanitized: ${imageFile.name}`);
                       } else {
                           results.push({
                               original: imageFile.name,
                               error: 'Sanitizer failed to process file',
                               success: false
                           });
                       }
                       
                       // Clean up temp directory
                       await this.sanitizer.cleanup(tempDir);
                   } catch (sanitizerError) {
                       await this.sanitizer.cleanup(tempDir);
                       results.push({
                           original: imageFile.name,
                           error: sanitizerError.message,
                           success: false
                       });
                   }
               }
           } catch (error) {
               console.log(`✗ Failed: ${imageFile.name} - ${error.message}`);
               results.push({
                   original: imageFile.name,
                   error: error.message,
                   success: false
               });
           }
       }
       
       return results;
   }

   // Update progress
   updateProgress(current, total, percent, message) {
       console.log(`Progress Update: ${current}/${total} (${percent.toFixed(1)}%) - ${message}`);
       if (this.progressCallback) {
           this.progressCallback({
               current: current,
               total: total,
               percent: percent,
               message: message
           });
       }
   }

   // Cancel processing
   cancel() {
       this.isCancelled = true;
   }
}

module.exports = ImageProcessor;