document.addEventListener('DOMContentLoaded', () => {
    const sceneContent = document.getElementById('scene-content');
    const rulerH = document.querySelector('.ruler-h');
    const rulerV = document.querySelector('.ruler-v');

    // Check if elements exist
    if (!sceneContent || !rulerH || !rulerV) {
        console.error('Ruler elements or scene content not found!');
        return;
    }

    function createTicks(ruler, dimension, isHorizontal) {
        ruler.innerHTML = ''; // Clear existing ticks/labels
        if (dimension <= 0) return; // Don't draw if dimension is invalid

        const interval = 50; // Major tick interval in pixels
        const mediumInterval = 25;
        const minorInterval = 5;
        // Ensure numTicks is calculated correctly even for small dimensions
        const numTicks = Math.max(0, Math.floor(dimension / minorInterval));

        for (let i = 0; i <= numTicks; i++) {
            const position = i * minorInterval;
            // Ensure ticks don't overflow the ruler bounds slightly
            if (position > dimension) continue;

            const tick = document.createElement('div');
            tick.classList.add('ruler-tick');

            let tickType = 'minor';
            if (i * minorInterval % interval === 0) {
                tickType = 'major';
            } else if (i * minorInterval % mediumInterval === 0) {
                tickType = 'medium';
            }
            tick.classList.add(tickType);

            if (isHorizontal) {
                tick.style.left = `${position}px`;
            } else {
                tick.style.top = `${position}px`;
            }

            ruler.appendChild(tick);

            // Add labels for major ticks
            if (tickType === 'major' && position > 0) { // Don't label 0
                const label = document.createElement('div');
                label.classList.add('ruler-label');
                label.textContent = position;
                if (isHorizontal) {
                    label.style.left = `${position}px`;
                } else {
                    // Adjust vertical label position slightly for better centering
                    label.style.top = `${position}px`; 
                }
                ruler.appendChild(label);
            }
        }
    }

    function updateRulers() {
        // Use dimensions of the scene-content-wrapper directly
        const rect = sceneContent.getBoundingClientRect();
        const width = sceneContent.offsetWidth; // Includes padding/border
        const height = sceneContent.offsetHeight; // Includes padding/border

        // console.log(`Updating rulers: Width=${width}, Height=${height}`); // Debug log

        // Check if dimensions are valid
        if (width > 0 && height > 0) {
            createTicks(rulerH, width, true);
            createTicks(rulerV, height, false);
        } else {
             // console.log('Skipping ruler update due to zero dimensions.'); // Debug log
             // Optionally clear rulers if dimensions become zero
             rulerH.innerHTML = '';
             rulerV.innerHTML = '';
        }
    }

    // Use ResizeObserver for more reliable dimension changes
    const resizeObserver = new ResizeObserver(entries => {
        // We are observing sceneContent, so it should be entries[0]
        if (entries && entries[0]) {
            // Use requestAnimationFrame to avoid layout thrashing and ensure rendering happens smoothly
            window.requestAnimationFrame(updateRulers);
        }
    });

    // Observe the scene content wrapper for size changes
    resizeObserver.observe(sceneContent);

    // Initial update - ensure layout is stable
    // Using requestAnimationFrame ensures it runs after the initial layout calculation
    window.requestAnimationFrame(() => {
        // A small delay might still be needed if images load later and affect size
        setTimeout(updateRulers, 50); 
    });

    // Also update when background image loads, as it defines the initial size
    const bgImage = document.getElementById('scene-background');
    if (bgImage) {
        bgImage.addEventListener('load', () => {
             window.requestAnimationFrame(() => {
                setTimeout(updateRulers, 50); // Delay after load
             });
        });
        // If the image is already loaded (e.g., cached), trigger update
        if (bgImage.complete && bgImage.naturalWidth > 0) {
             window.requestAnimationFrame(() => {
                setTimeout(updateRulers, 50); 
             });
        }
    }
});
