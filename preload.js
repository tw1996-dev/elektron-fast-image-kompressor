/*
* preload.js - Secure Bridge Between UI and Main Process
* 
* Provides:
* - Safe communication channel via contextBridge
* - Image compression API for renderer process
* - Folder selection functionality
* - Progress event handling and cleanup
* - Window control functions for custom title bar
* - Security isolation between frontend and backend
* - Compression cancellation support
*/

const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge between UI and main process
contextBridge.exposeInMainWorld('electronAPI', {
   // Image compression function
   compressImages: (folderPath) => ipcRenderer.invoke('compress-images', folderPath),
   
   // Cancel compression function
   cancelCompression: () => ipcRenderer.invoke('cancel-compression'),
   
   // Folder selection function
   selectFolder: () => ipcRenderer.invoke('select-folder'),
   
   // Compression progress listening
   onCompressionProgress: (callback) => {
       ipcRenderer.on('compression-progress', (event, data) => callback(data));
   },
   
   // Remove all listeners
   removeAllListeners: (channel) => {
       ipcRenderer.removeAllListeners(channel);
   },
   
   // Window control functions
   minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
   maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
   closeWindow: () => ipcRenderer.invoke('window-close'),

   // Window state listener
   onWindowStateChange: (callback) => {
       ipcRenderer.on('window-state-changed', (event, isMaximized) => callback(isMaximized));
   }
});