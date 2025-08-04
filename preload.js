/*
 * preload.js - Secure Bridge Between UI and Main Process
 * 
 * Provides:
 * - Safe communication channel via contextBridge
 * - Image compression API for renderer process
 * - Folder selection functionality
 * - Progress event handling and cleanup
 * - Security isolation between frontend and backend
 */

const { contextBridge, ipcRenderer } = require('electron');

// Bezpieczny mostek między UI a main procesem
contextBridge.exposeInMainWorld('electronAPI', {
    // Funkcja do kompresji obrazów
    compressImages: (folderPath) => ipcRenderer.invoke('compress-images', folderPath),
    
    // Funkcja do wyboru folderu (dodamy później)
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    
    // Nasłuchiwanie postępu kompresji
    onCompressionProgress: (callback) => {
        ipcRenderer.on('compression-progress', (event, data) => callback(data));
    },
    
    // Usunięcie nasłuchiwania
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    }
});