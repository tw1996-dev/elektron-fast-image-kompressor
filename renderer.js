/*
 * renderer.js - Frontend UI Logic for Elektron Fast Image Kompressor
 * 
 * Handles:
 * - Drag & drop folder functionality
 * - UI state management (initial, progress, success, error)
 * - Progress tracking and display updates
 * - Communication with main process via electronAPI
 * - User interactions (buttons, events)
 * - File processing workflow coordination
 * - Real cancellation support
 */


// Custom Title Bar Controls
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const closeBtn = document.getElementById('closeBtn');

// Window control functions
minimizeBtn.addEventListener('click', () => {
   window.electronAPI.minimizeWindow();
});

maximizeBtn.addEventListener('click', () => {
   window.electronAPI.maximizeWindow();
});

closeBtn.addEventListener('click', () => {
   window.electronAPI.closeWindow();
});

// Update maximize button icon based on window state
window.electronAPI.onWindowStateChange((isMaximized) => {
   maximizeBtn.textContent = isMaximized ? '❐' : '□';
});

// DOM elements
const dropZone = document.getElementById('dropZone');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const selectButton = document.getElementById('selectButton');
const cancelButton = document.getElementById('cancelButton');
const newCompressionButton = document.getElementById('newCompressionButton');
const retryButton = document.getElementById('retryButton');

// Progress elements
const progressTitle = document.getElementById('progressTitle');
const currentFile = document.getElementById('currentFile');
const fileCounter = document.getElementById('fileCounter');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');

// Result elements
const successResult = document.getElementById('successResult');
const errorResult = document.getElementById('errorResult');
const resultStats = document.getElementById('resultStats');
const errorMessage = document.getElementById('errorMessage');

let isProcessing = false;
let isCancelling = false;
let selectedFolderPath = null;
let startTime = null;
let timerInterval = null;
let lastProgressUpdate = { current: 0, total: 0, rate: 0 };

// Drag and Drop functionality
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    console.log('=== RENDERER: Drop event triggered ===');
    
    const files = Array.from(e.dataTransfer.files);
    console.log('=== RENDERER: Dropped files ===', files);
    
    if (files.length > 0) {
        const firstFile = files[0];
        console.log('=== RENDERER: First file details ===', {
            name: firstFile.name,
            type: firstFile.type,
            size: firstFile.size,
            path: firstFile.path
        });
        
        // Check if it's a directory by checking path property
        if (firstFile.path && firstFile.type === '') {
            selectedFolderPath = firstFile.path;
            console.log('=== RENDERER: Detected folder path ===', selectedFolderPath);
            startCompression(selectedFolderPath);
        } else {
            showError('Please drop a folder, not individual files.');
        }
    } else {
        showError('Please drop a folder with images.');
    }
});

// Select folder button
selectButton.addEventListener('click', async () => {
    try {
        const result = await window.electronAPI.selectFolder();
        if (result && !result.canceled) {
            selectedFolderPath = result.filePaths[0];
            startCompression(selectedFolderPath);
        }
    } catch (error) {
        showError('Error selecting folder: ' + error.message);
    }
});

// Cancel button - REAL CANCELLATION
cancelButton.addEventListener('click', async () => {
    if (isProcessing && !isCancelling) {
        console.log('=== CANCELLATION REQUESTED ===');
        isCancelling = true;
        
        // Update UI immediately to show cancelling state
        progressTitle.textContent = 'Cancelling...';
        currentFile.textContent = 'Stopping compression...';
        cancelButton.textContent = 'Cancelling...';
        cancelButton.disabled = true;
        
        try {
            // Send cancellation signal to main process
            await window.electronAPI.cancelCompression();
            console.log('=== CANCELLATION SIGNAL SENT ===');
        } catch (error) {
            console.error('Error sending cancellation signal:', error);
        }
    }
});

// New compression button
newCompressionButton.addEventListener('click', () => {
    resetToInitialState();
});

// Retry button
retryButton.addEventListener('click', () => {
    resetToInitialState();
});

// Real-time timer update function
function updateTimer() {
    if (!startTime || !lastProgressUpdate.total || !lastProgressUpdate.current || isCancelling) return;
    
    const now = Date.now();
    const elapsed = (now - startTime) / 1000; // seconds
    const current = lastProgressUpdate.current;
    const total = lastProgressUpdate.total;
    
    if (current > 0 && elapsed > 5) { // Wait at least 5 seconds for stable estimate
        const currentRate = current / elapsed; // files per second
        
        // Use smoothed rate (if we have previous rate, average it)
        if (!lastProgressUpdate.smoothedRate) {
            lastProgressUpdate.smoothedRate = currentRate;
        } else {
            // Smooth with 70% previous rate + 30% current rate
            lastProgressUpdate.smoothedRate = (lastProgressUpdate.smoothedRate * 0.7) + (currentRate * 0.3);
        }
        
        const remainingFiles = total - current;
        const estimatedSeconds = remainingFiles / lastProgressUpdate.smoothedRate;
        
        let timeRemaining = '';
        if (estimatedSeconds > 60) {
            const minutes = Math.ceil(estimatedSeconds / 60);
            timeRemaining = ` • ~${minutes}min remaining`;
        } else if (estimatedSeconds > 0) {
            timeRemaining = ` • ~${Math.ceil(estimatedSeconds)}s remaining`;
        }
        
        // Update only timer part of title
        if (!isCancelling) {
            progressTitle.textContent = 'Processing images...' + timeRemaining;
        }
    } else if (elapsed < 5 && !isCancelling) {
        // Show "calculating..." for first few seconds
        progressTitle.textContent = 'Processing images... • calculating time...';
    }
}

// Start compression process
async function startCompression(folderPath) {
    if (isProcessing) return;

    // Reset and cleanup timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    startTime = null;
    lastProgressUpdate = { current: 0, total: 0, rate: 0 };
    isCancelling = false;

    isProcessing = true;
    showProgressSection();
    
    try {
        updateProgress(0, 0, 0, 'Initializing...');
        
        const result = await window.electronAPI.compressImages(folderPath);
        
        if (result.success) {
            if (result.cancelled) {
                showCancellationResult();
            } else {
                showSuccess(result);
            }
        } else {
            if (result.cancelled) {
                showCancellationResult();
            } else {
                showError(result.error || 'Unknown error occurred');
            }
        }
    } catch (error) {
        if (isCancelling) {
            showCancellationResult();
        } else {
            showError('Compression failed: ' + error.message);
        }
    } finally {
        isProcessing = false;
        isCancelling = false;
        
        // Reset cancel button
        cancelButton.textContent = 'Cancel';
        cancelButton.disabled = false;
        
        // Clean up progress listener and timer
        window.electronAPI.removeAllListeners('compression-progress');
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }
}

// Update progress display
function updateProgress(current, total, percent, currentFileName) {
    if (isCancelling) return; // Don't update progress during cancellation
    
    // Initialize start time and timer on first real progress
    if (startTime === null && current > 0) {
        startTime = Date.now();
        // Start real-time timer that updates every second
        timerInterval = setInterval(updateTimer, 1000);
    }
    
    // Store progress data for timer calculations
    lastProgressUpdate = { 
        current, 
        total, 
        rate: 0,
        smoothedRate: lastProgressUpdate.smoothedRate || 0  // Preserve smoothed rate
    };
    
    // Update UI elements immediately
    currentFile.textContent = currentFileName || '--';
    fileCounter.textContent = `${current}/${total}`;
    progressFill.style.width = percent + '%';
    progressPercent.textContent = Math.round(percent) + '%';
    
    // Update timer immediately too
    updateTimer();
}

// Show cancellation result
function showCancellationResult() {
    hideAllSections();
    resultsSection.classList.remove('hidden');
    errorResult.classList.remove('hidden');
    
    // Update error result to show cancellation
    const errorTitle = errorResult.querySelector('h3');
    errorTitle.textContent = '⏹️ Compression cancelled';
    errorTitle.style.color = '#ff8800'; // Orange color for cancellation
    
    errorMessage.textContent = 'Compression was cancelled by user. No files were processed.';
    
    // Change retry button text
    const retryBtn = document.getElementById('retryButton');
    retryBtn.textContent = 'Start new compression';
}

// Show success result
function showSuccess(result) {
    hideAllSections();
    resultsSection.classList.remove('hidden');
    successResult.classList.remove('hidden');
    
    // Build stats HTML with compression data if available
    let statsHTML = `
    <div><span class="result-label">Files processed:</span> <span class="result-value">${result.processedFiles || 0}</span></div>
    <div><span class="result-label">Output folder:</span> <span class="result-value">${result.outputPath || 'N/A'}</span></div>`;
    
    // Add compression statistics if available
    if (result.compressionStats) {
        const stats = result.compressionStats;
        statsHTML += `
        <div class="stats-divider"></div>
        <div><span class="result-label">Original size:</span> <span class="result-value">${stats.originalSize}</span></div>
        <div><span class="result-label">Compressed size:</span> <span class="result-value">${stats.compressedSize}</span></div>
        <div><span class="result-label">Space saved:</span> <span class="result-value result-highlight">${stats.spaceSaved} (${stats.compressionPercent})</span></div>`;
    }
    
    statsHTML += `<div class="result-success">Compression completed successfully!</div>`;
    
    resultStats.innerHTML = statsHTML;
}

// Show error result
function showError(error) {
    hideAllSections();
    resultsSection.classList.remove('hidden');
    errorResult.classList.remove('hidden');
    
    // Reset error styling (in case it was changed for cancellation)
    const errorTitle = errorResult.querySelector('h3');
    errorTitle.textContent = '❌ An error occurred';
    errorTitle.style.color = ''; // Reset to default color
    
    errorMessage.textContent = error;
    
    // Reset retry button text
    const retryBtn = document.getElementById('retryButton');
    retryBtn.textContent = 'Try again';
}

// Show progress section
function showProgressSection() {
    hideAllSections();
    progressSection.classList.remove('hidden');
    updateProgress(0, 0, 0, 'Starting...');
}

// Hide all sections
function hideAllSections() {
    dropZone.classList.add('hidden');
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    successResult.classList.add('hidden');
    errorResult.classList.add('hidden');
}

// Reset to initial state
function resetToInitialState() {
    isProcessing = false;
    isCancelling = false;
    selectedFolderPath = null;
    
    // Reset cancel button
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = false;
    
    // Cleanup timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    startTime = null;
    
    hideAllSections();
    dropZone.classList.remove('hidden');
}

// Setup progress listener
window.electronAPI.onCompressionProgress((progressData) => {
    if (!isCancelling) {
        updateProgress(
            progressData.current,
            progressData.total,
            progressData.percent,
            progressData.message
        );
    }
});

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    console.log('Elektron Fast Image Kompressor ready!');
});