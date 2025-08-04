/*
* main.js - Electron Main Process Controller
* 
* Handles:
* - Application lifecycle (startup, window management, quit)
* - Main window creation with custom title bar
* - IPC communication handlers for image compression
* - Development tools and debugging setup
* - Cross-platform window behavior management
* - Real compression cancellation support
*/

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ImageProcessor = require('./imageProcessor');

let mainWindow;
let currentProcessor = null; // Track current processor for cancellation

function createWindow() {
   mainWindow = new BrowserWindow({
       width: 900,
       height: 700,
       minWidth: 600,
       minHeight: 400,
       webPreferences: {
           nodeIntegration: false,
           contextIsolation: true,
           preload: path.join(__dirname, 'preload.js')
       },
       frame: false,  // Disable default frame
       title: 'Elektron Fast Image Kompressor',
       show: false 
       
   });

   // Disable default menu
   mainWindow.setMenu(null);

   mainWindow.loadFile('index.html');
   
   // Show window when ready (smoother startup)
   mainWindow.once('ready-to-show', () => {
       mainWindow.show();
   });
   
   // DevTools only in development
   if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
       mainWindow.webContents.openDevTools();
   }
}

app.whenReady().then(() => {
   createWindow();
});

app.on('window-all-closed', () => {
   if (process.platform !== 'darwin') {
       app.quit();
   }
});

app.on('activate', () => {
   if (BrowserWindow.getAllWindows().length === 0) {
       createWindow();
   }
});

// Handler for image compression
ipcMain.handle('compress-images', async (event, folderPath) => {
   const processor = new ImageProcessor();
   currentProcessor = processor; // Store reference for cancellation
   
   try {
       console.log('=== COMPRESSION DEBUG ===');
       console.log('Received folder path:', folderPath);
       console.log('Type of folderPath:', typeof folderPath);
       
       // Convert path if needed
       const fs = require('fs');
       const normalizedPath = require('path').resolve(folderPath);
       console.log('Normalized path:', normalizedPath);
       console.log('Normalized path exists?', fs.existsSync(normalizedPath));
       console.log('========================');
       
       if (!fs.existsSync(normalizedPath)) {
           throw new Error(`Selected folder does not exist: ${normalizedPath}`);
       }
       
       // Throttling variables for progress updates
       let lastProgressSent = 0;
       let lastProgressData = null;
       const PROGRESS_THROTTLE = 100; // Send max 1 update per 100ms (10 updates per second)
       
       // Setup progress callback with throttling
       const progressCallback = (progressData) => {
           // Don't send progress if cancelled
           if (processor.isCancelled) return;
           
           const now = Date.now();
           lastProgressData = progressData; // Always store latest data
           
           // Send immediately if enough time has passed, or if it's the final update
           if (now - lastProgressSent >= PROGRESS_THROTTLE || progressData.percent >= 100) {
               event.sender.send('compression-progress', progressData);
               lastProgressSent = now;
               console.log(`Progress sent: ${progressData.current}/${progressData.total} (${progressData.percent.toFixed(1)}%)`);
           }
       };
       
       // Send any pending progress updates at the end
       const sendFinalProgress = () => {
           if (lastProgressData && Date.now() - lastProgressSent >= PROGRESS_THROTTLE && !processor.isCancelled) {
               event.sender.send('compression-progress', lastProgressData);
               console.log(`Final progress sent: ${lastProgressData.current}/${lastProgressData.total}`);
           }
       };
       
       const result = await processor.processImages(normalizedPath, progressCallback);
       
       // Check if was cancelled
       if (processor.isCancelled) {
           console.log('=== COMPRESSION WAS CANCELLED ===');
           return {
               success: false,
               cancelled: true,
               error: 'Compression was cancelled by user'
           };
       }
       
       // Ensure final progress is sent
       sendFinalProgress();
       
       return {
           success: true,
           processedFiles: result.processedFiles,
           totalFiles: result.totalFiles,
           outputPath: result.outputPath,
           message: `Successfully compressed ${result.processedFiles} images!`,
           compressionStats: result.compressionStats
       };
       
   } catch (error) {
       console.error('Compression error:', error);
       
       // Check if error was due to cancellation
       if (processor.isCancelled || error.message.includes('cancelled')) {
           console.log('=== COMPRESSION CANCELLED WITH ERROR ===');
           return {
               success: false,
               cancelled: true,
               error: 'Compression was cancelled by user'
           };
       }
       
       return {
           success: false,
           error: error.message
       };
   } finally {
       currentProcessor = null; // Clear reference
   }
});

// Handler for compression cancellation
ipcMain.handle('cancel-compression', async () => {
   try {
       console.log('=== CANCELLATION RECEIVED ===');
       
       if (currentProcessor) {
           console.log('=== CANCELLING CURRENT PROCESSOR ===');
           await currentProcessor.cancel();
           console.log('=== PROCESSOR CANCELLED SUCCESSFULLY ===');
           return { success: true };
       } else {
           console.log('=== NO ACTIVE PROCESSOR TO CANCEL ===');
           return { success: false, message: 'No active compression to cancel' };
       }
   } catch (error) {
       console.error('Error during cancellation:', error);
       return { success: false, error: error.message };
   }
});

// Handler for folder selection
ipcMain.handle('select-folder', async () => {
   try {
       const result = await dialog.showOpenDialog(mainWindow, {
           properties: ['openDirectory'],
           title: 'Select folder with images'
       });
       
       // Debug log
       console.log('=== FOLDER SELECTION DEBUG ===');
       console.log('Dialog result:', result);
       if (result.filePaths && result.filePaths.length > 0) {
           console.log('Selected path:', result.filePaths[0]);
           console.log('Path exists?', require('fs').existsSync(result.filePaths[0]));
       }
       console.log('==============================');
       
       return result;
   } catch (error) {
       console.error('Folder selection error:', error);
       return { canceled: true, error: error.message };
   }
});

// Window control handlers
ipcMain.handle('window-minimize', () => {
    mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.handle('window-close', () => {
    mainWindow.close();
});