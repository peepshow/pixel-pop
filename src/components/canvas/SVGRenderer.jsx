import React, { memo, useMemo, useCallback, useRef, useEffect, useState, forwardRef } from 'react';
import styled from 'styled-components';

// Add a cache for shape paths to avoid recalculations
const pathCache = new Map();

const SVGWrapper = styled.div`
  position: relative;
  width: fit-content;
  height: fit-content;
  will-change: transform;
  transform: translateZ(0);
  backface-visibility: hidden;
  touch-action: none; /* Disable browser touch behaviors */
`;

const SVGContainer = styled.svg`
  display: block;
  background-color: ${props => props.$backgroundColor || 'rgba(240, 240, 240, 1)'};
  overflow: visible;
  transform-origin: top left;
  image-rendering: pixelated;
  transform-origin: 0 0;
  image-rendering: crisp-edges;
  shape-rendering: crispEdges;
  cursor: inherit; /* Inherit cursor from parent */
  will-change: transform; /* Hint for hardware acceleration */
  pointer-events: auto; /* Ensure mouse events are captured */
  backface-visibility: hidden; /* Additional GPU acceleration */
  perspective: 1000; /* Helps with 3D transforms */
  -webkit-font-smoothing: antialiased; /* Smooth rendering */
  -moz-osx-font-smoothing: grayscale; /* Smooth rendering in Firefox */
  filter: translateZ(0); /* Force GPU rendering */
  touch-action: none; /* Disable browser touch behaviors */
`;

const Pixel = styled.path`
  cursor: inherit; /* Inherit cursor from parent container */
  will-change: transform, filter; /* Hint for GPU acceleration */
  transform: translateZ(0); /* Force GPU rendering */
  backface-visibility: hidden; /* Additional GPU hint */
`;

const InteractionPixel = styled.path`
  cursor: inherit; /* Inherit cursor from parent container */
  will-change: transform, filter; /* Hint for GPU acceleration */
  transform: translateZ(0); /* Force GPU rendering */
  backface-visibility: hidden; /* Additional GPU hint */
`;

// Add a new component for the interaction overlay
const InteractionOverlay = styled.rect`
  fill: transparent;
  stroke: none;
  pointer-events: all;
  cursor: inherit;
  will-change: transform;
  transform: translateZ(0);
`;

// Add touch event handlers that always prevent default
const preventAllTouchEvents = (event) => {
  event.preventDefault();
};

const SVGRenderer = memo(forwardRef(({
  gridWidth,
  gridHeight,
  pixelSize,
  gridGap,
  pixelData,
  showGrid,
  mode,
  interactionSettings,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onCanvasMouseLeave,
  onClick,
  zoomState,
  cornerRadius = { enabled: false, topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
  pixelShape = 'rectangle', // Default to rectangle
  customShape = { path: '', viewBox: '0 0 100 100' },
  backgroundColor = '#f0f0f0',
  activeTool,
  glowEnabled = false,
  glowSettings = {},
  bulbEnabled = false,
  bulbSettings = {}
}, ref) => {
  // Calculate dimensions
  const totalWidth = gridWidth * (pixelSize + gridGap);
  const totalHeight = gridHeight * (pixelSize + gridGap);
  
  // State for tracking viewport position and dimensions
  const [viewportState, setViewportState] = useState({
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    scale: 1
  });
  
  // Reference to SVG container
  const svgRef = useRef(null);
  
  // Add a ref to track request animation frame
  const rafRef = useRef(null);
  
  // Track if we're in a multi-touch gesture
  const multiTouchRef = useRef(false);
  const touchTimeoutRef = useRef(null);
  
  // Update viewport dimensions when container changes size or zoom changes
  useEffect(() => {
    const updateViewport = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          const rect = container.getBoundingClientRect();
          const svgRect = svgRef.current.getBoundingClientRect();
          const scale = svgRect.width / totalWidth;
          
          // Only update state if values have changed significantly
          setViewportState(prev => {
            if (
              Math.abs(prev.width - rect.width / scale) > 1 ||
              Math.abs(prev.height - rect.height / scale) > 1 ||
              Math.abs(prev.scale - scale) > 0.01
            ) {
              return {
                left: 0,
                top: 0,
                width: rect.width / scale,
                height: rect.height / scale,
                scale
              };
            }
            return prev;
          });
        }
      }
    };
    
    // Initial update
    updateViewport();
    
    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to avoid multiple rapid updates
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(updateViewport);
    });
    
    if (svgRef.current?.parentElement) {
      resizeObserver.observe(svgRef.current.parentElement);
    }
    
    return () => {
      resizeObserver.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [totalWidth]);
  
  // Expose SVG ref to parent component
  useEffect(() => {
    if (ref && svgRef.current) {
      ref.current = svgRef.current;
    }
  }, [ref, svgRef.current]);
  
  // Helper function to convert SVG coordinates to grid coordinates
  const getGridCoordinates = useCallback((e) => {
    if (!svgRef.current) return { gridX: -1, gridY: -1, buttons: 0 };
    
    const svgElement = svgRef.current; // Use the ref
    const svgRect = svgElement.getBoundingClientRect();
    
    // Calculate the scale factor between the current rendered size and the original size
    const scaleX = svgRect.width / totalWidth;
    const scaleY = svgRect.height / totalHeight;
    
    // Calculate coordinates relative to the SVG element
    const relX = e.clientX - svgRect.left;
    const relY = e.clientY - svgRect.top;
    
    // Convert to the original coordinate space (before scaling)
    const normalizedX = relX / scaleX;
    const normalizedY = relY / scaleY;
    
    // Calculate the cell size in the original coordinate space
    const cellSize = pixelSize + gridGap;
    
    // Convert to grid coordinates
    const gridX = Math.floor(normalizedX / cellSize);
    const gridY = Math.floor(normalizedY / cellSize);
    
    return { 
      gridX: Math.max(0, Math.min(gridX, gridWidth - 1)), 
      gridY: Math.max(0, Math.min(gridY, gridHeight - 1)),
      buttons: e.buttons,
    };
  }, [gridWidth, gridHeight, pixelSize, gridGap, totalWidth, totalHeight, svgRef]);
  
  // Event handlers simplified
  const handleClick = useCallback((e) => {
    // Calculate grid coordinates from the click position
    const coords = getGridCoordinates(e);
    
    // Only process clicks within the grid
    if (coords.gridX >= 0 && coords.gridY >= 0 && 
        coords.gridX < gridWidth && coords.gridY < gridHeight) {
      // Pass the coordinates to the onClick handler
      if (onClick) onClick(coords);
    }
  }, [getGridCoordinates, onClick, gridWidth, gridHeight]);

  const handleMouseDown = useCallback((e) => {
    // Calculate grid coordinates from the event
    const coords = getGridCoordinates(e);
    
    // Only process if coordinates are within the grid
    if (coords.gridX >= 0 && coords.gridY >= 0 && 
        coords.gridX < gridWidth && coords.gridY < gridHeight) {
      if (onCanvasMouseDown) onCanvasMouseDown(coords);
    }
    e.preventDefault(); // Still prevent default actions like text selection
  }, [getGridCoordinates, onCanvasMouseDown, gridWidth, gridHeight]);

  const handleMouseUp = useCallback((e) => {
    // Calculate grid coordinates from the event
    const coords = getGridCoordinates(e);
    
    // Only process if coordinates are within the grid
    if (coords.gridX >= 0 && coords.gridY >= 0 && 
        coords.gridX < gridWidth && coords.gridY < gridHeight) {
      if (onCanvasMouseUp) onCanvasMouseUp(coords);
    }
    e.preventDefault();
  }, [getGridCoordinates, onCanvasMouseUp, gridWidth, gridHeight]);

  const handleMouseMove = useCallback((e) => {
    // Throttle mouse move events with requestAnimationFrame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      const coords = getGridCoordinates(e);
      
      // Only process if coordinates are within the grid
      if (coords.gridX >= 0 && coords.gridY >= 0 && 
          coords.gridX < gridWidth && coords.gridY < gridHeight) {
        if (onCanvasMouseMove) onCanvasMouseMove(coords);
      }
    });
    
    e.preventDefault(); 
  }, [getGridCoordinates, onCanvasMouseMove, gridWidth, gridHeight]);

  const handleMouseLeave = useCallback((e) => {
    if (onCanvasMouseLeave) onCanvasMouseLeave(); // No coords needed
    e.preventDefault();
  }, [onCanvasMouseLeave]);
  
  // Touch event handlers that map to mouse events
  const handleTouchStart = useCallback((e) => {
    if (!svgRef.current) return;
    e.preventDefault(); // Always prevent default
    
    // Clear any existing timeout
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
    
    // Track multi-touch state
    if (e.touches.length > 1) {
      multiTouchRef.current = true;
      return; // Don't initiate painting for multi-touch
    }
    
    // Add a small delay to detect if another finger is added (for pinch gesture)
    touchTimeoutRef.current = setTimeout(() => {
      // Only proceed if we're still in a single-touch state
      if (!multiTouchRef.current) {
        // Get the first touch point
        const touch = e.touches[0];
        
        // Create a simulated mouse event with touch coordinates
        const touchEvent = {
          clientX: touch.clientX,
          clientY: touch.clientY,
          buttons: 1, // Simulate left mouse button
          preventDefault: () => {}
        };
        
        // Calculate coordinates and call the mousedown handler
        const coords = getGridCoordinates(touchEvent);
        
        // Call the mouse down handler with calculated coordinates
        if (onCanvasMouseDown) {
          onCanvasMouseDown({
            ...coords,
            buttons: 1,
            metaKey: false,
            originalEvent: e
          });
        }
      }
      touchTimeoutRef.current = null;
    }, 20); // Short 20ms delay to detect multi-touch
  }, [getGridCoordinates, onCanvasMouseDown, svgRef]);
  
  const handleTouchMove = useCallback((e) => {
    if (!svgRef.current) return;
    e.preventDefault(); // Always prevent default
    
    // Don't process touch moves during multi-touch
    if (multiTouchRef.current || e.touches.length > 1) {
      multiTouchRef.current = true;
      return;
    }
    
    // Throttle touch move events with requestAnimationFrame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      // Get the first touch point
      const touch = e.touches[0];
      
      // Create a simulated mouse event with touch coordinates
      const touchEvent = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        buttons: 1, // Simulate left mouse button
        preventDefault: () => {}
      };
      
      // Calculate coordinates and call the mousemove handler
      const coords = getGridCoordinates(touchEvent);
      
      // Call the mouse move handler with calculated coordinates
      if (onCanvasMouseMove) {
        onCanvasMouseMove({
          ...coords,
          buttons: 1,
          metaKey: false,
          originalEvent: e
        });
      }
    });
  }, [getGridCoordinates, onCanvasMouseMove, svgRef]);
  
  const handleTouchEnd = useCallback((e) => {
    if (!svgRef.current) return;
    e.preventDefault(); // Always prevent default
    
    // Reset multi-touch state if all fingers are lifted
    if (e.touches.length === 0) {
      multiTouchRef.current = false;
    }
    
    // Don't trigger mouseUp during multi-touch gesture
    if (multiTouchRef.current) {
      return;
    }
    
    // Get the first changed touch point (the one that ended)
    let touchEvent;
    
    if (e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      
      // Create a simulated mouse event with touch coordinates
      touchEvent = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        buttons: 0, // No buttons pressed
        preventDefault: () => {}
      };
    } else {
      // If no changedTouches, use a default position
      touchEvent = {
        clientX: 0,
        clientY: 0,
        buttons: 0,
        preventDefault: () => {}
      };
    }
    
    // Calculate coordinates and call the mouseup handler
    const coords = getGridCoordinates(touchEvent);
    
    // Call the mouseup handler with calculated coordinates
    if (onCanvasMouseUp) {
      onCanvasMouseUp({
        ...coords,
        buttons: 0,
        metaKey: false,
        originalEvent: e
      });
    }
    
    // Simulate a click if needed
    if (onClick) {
      onClick(coords);
    }
  }, [getGridCoordinates, onCanvasMouseUp, onClick, svgRef]);
  
  const handleTouchCancel = useCallback((e) => {
    // Treat touch cancel like mouse leave
    if (onCanvasMouseLeave) onCanvasMouseLeave();
    // Do NOT prevent default for touch cancel events
  }, [onCanvasMouseLeave]);
  
  // Calculate visible area for windowing
  const visibleArea = useMemo(() => {
    const { left, top, width, height, scale } = viewportState;
    const cellSize = pixelSize + gridGap;
    
    // Add a buffer around visible area
    const buffer = 5; // Number of cells to buffer
    
    const startX = Math.max(0, Math.floor(left / cellSize) - buffer);
    const endX = Math.min(gridWidth, Math.ceil((left + width) / cellSize) + buffer);
    const startY = Math.max(0, Math.floor(top / cellSize) - buffer);
    const endY = Math.min(gridHeight, Math.ceil((top + height) / cellSize) + buffer);
    
    return { startX, endX, startY, endY };
  }, [viewportState, pixelSize, gridGap, gridWidth, gridHeight]);
  
  // Memoize grid lines - only render visible lines
  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    
    const lines = [];
    const cellSize = pixelSize + gridGap;
    const { startX, endX, startY, endY } = visibleArea;
    
    // Vertical lines within visible area
    for (let x = startX; x <= endX; x++) {
      lines.push(
        <line
          key={`v${x}`}
          x1={x * cellSize - 0.5}
          y1={0}
          x2={x * cellSize - 0.5}
          y2={totalHeight}
          stroke="rgba(128, 128, 128, 0.5)"
          strokeWidth="1"
        />
      );
    }
    
    // Horizontal lines within visible area
    for (let y = startY; y <= endY; y++) {
      lines.push(
        <line
          key={`h${y}`}
          x1={0}
          y1={y * cellSize - 0.5}
          x2={totalWidth}
          y2={y * cellSize - 0.5}
          stroke="rgba(128, 128, 128, 0.5)"
          strokeWidth="1"
        />
      );
    }
    
    return lines;
  }, [showGrid, pixelSize, gridGap, visibleArea, totalWidth, totalHeight]);
  
  // Helper function to calculate corner radius based on pixel size and settings
  const getCornerRadius = useCallback((corner) => {
    if (!cornerRadius?.enabled) return 0;
    
    const maxRadius = pixelSize; // Maximum possible radius is half the pixel size
    // Use the same calculation as CanvasRenderer
    const percentage = cornerRadius[corner] / 100; // Convert percentage to decimal
    
    return Math.min((pixelSize * cornerRadius[corner]) / 100, maxRadius);
  }, [cornerRadius, pixelSize]);

  // Create a shape path based on pixel shape type
  const createShapePath = (x, y, size, shape, cornerRadius, customShape) => {
    // Generate a cache key based on all parameters that affect the path
    const cacheKey = `${x}_${y}_${size}_${shape}_${JSON.stringify(cornerRadius)}_${customShape?.path || ''}`;
    
    // Check if this path is already in the cache
    if (pathCache.has(cacheKey)) {
      return pathCache.get(cacheKey);
    }
    
    // If not in cache, calculate the path
    let path;
    
    if (shape === 'custom' && customShape?.path) {
      path = customShape.path;
    } else {
      switch (shape) {
        case 'circle': {
          const radius = size / 2;
          const cx = x + radius;
          const cy = y + radius;
          path = `M ${cx},${y} A ${radius},${radius} 0 1,1 ${cx-0.001},${y} Z`;
          break;
        }
        case 'diamond': {
          const mid = size / 2;
          path = `M ${x + mid},${y} L ${x + size},${y + mid} L ${x + mid},${y + size} L ${x},${y + mid} Z`;
          break;
        }
        case 'triangle':
          path = `M ${x + size/2},${y} L ${x + size},${y + size} L ${x},${y + size} Z`;
          break;
        case 'hexagon': {
          const radius = size / 2;
          const cx = x + radius;
          const cy = y + radius;
          path = `M `;
          
          for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3;
            const px = cx + radius * Math.cos(angle);
            const py = cy + radius * Math.sin(angle);
            
            if (i === 0) {
              path += `${px},${py} `;
            } else {
              path += `L ${px},${py} `;
            }
          }
          
          path += 'Z';
          break;
        }
        case 'rectangle':
        default:
          if (cornerRadius?.enabled) {
            // Calculate actual radius values in pixels
            const maxRadius = size / 2;
            
            const topLeftRadius = Math.min((size * cornerRadius.topLeft) / 100, maxRadius);
            const topRightRadius = Math.min((size * cornerRadius.topRight) / 100, maxRadius);
            const bottomLeftRadius = Math.min((size * cornerRadius.bottomLeft) / 100, maxRadius);
            const bottomRightRadius = Math.min((size * cornerRadius.bottomRight) / 100, maxRadius);
      
            // Create rounded rectangle path
            path = `
              M ${x + topLeftRadius},${y}
              H ${x + size - topRightRadius}
              Q ${x + size},${y} ${x + size},${y + topRightRadius}
              V ${y + size - bottomRightRadius}
              Q ${x + size},${y + size} ${x + size - bottomRightRadius},${y + size}
              H ${x + bottomLeftRadius}
              Q ${x},${y + size} ${x},${y + size - bottomLeftRadius}
              V ${y + topLeftRadius}
              Q ${x},${y} ${x + topLeftRadius},${y}
              Z
            `;
          } else {
            // Default rectangle
            path = `M ${x},${y} H ${x + size} V ${y + size} H ${x} Z`;
          }
      }
    }
    
    // Store path in cache before returning
    pathCache.set(cacheKey, path);
    
    // Limit cache size to prevent memory leaks
    if (pathCache.size > 1000) {
      // Delete the oldest entry
      const firstKey = pathCache.keys().next().value;
      pathCache.delete(firstKey);
    }
    
    return path;
  };

  // Add a force update mechanism to ensure rendering when the parent component provides new pixelData
  const [updateCounter, setUpdateCounter] = useState(0);
  const prevPixelDataRef = useRef(pixelData);
  
  // Force update when pixelData changes
  useEffect(() => {
    // Check if the pixelData reference has changed or the content is different
    if (pixelData !== prevPixelDataRef.current) {
      setUpdateCounter(prev => prev + 1);
      prevPixelDataRef.current = pixelData;
    }
  }, [pixelData]);

  // Memoize pixel rendering
  const renderPixels = useMemo(() => {
    const glowPaths = [];   // Array for glow layers
    const crispPaths = [];  // Array for crisp pixel layers
    const bulbPaths = [];   // Array for bulb overlays
    
    const cellSize = pixelSize + gridGap;
    const { startX, endX, startY, endY } = visibleArea;

    for (let y = startY; y < endY; y++) { 
        for (let x = startX; x < endX; x++) {
            const color = pixelData[y]?.[x];
            if (color) {
                const xPos = x * cellSize + (gridGap / 2);
                const yPos = y * cellSize + (gridGap / 2);
                const pathData = createShapePath(xPos, yPos, pixelSize, pixelShape, cornerRadius, customShape);
                const baseKey = `${x}-${y}`;

                // --- Crisp Pixel --- 
                // Render the correct shape based on pixelShape
                if (pixelShape === 'circle') {
                    const radius = pixelSize / 2;
                    const centerX = xPos + radius;
                    const centerY = yPos + radius;
                    crispPaths.push(
                        <circle // <<< Use native circle for crisp pixel
                            key={`${baseKey}-pixel-circle`}
                            cx={centerX}
                            cy={centerY}
                            r={radius}
                            fill={color}
                        />
                    );
                } else {
                    // <<< Default: Use Pixel path for other shapes >>>
                    crispPaths.push(
                        <Pixel
                            key={`${baseKey}-pixel`}
                            d={pathData}
                            fill={color}
                        />
                    );
                }

                // --- Glow Effect Layer (if enabled) ---
                if (glowEnabled) {
                    if (pixelShape === 'circle') {
                        const radius = pixelSize / 2;
                        const centerX = xPos + radius;
                        const centerY = yPos + radius;
                        glowPaths.push(
                            <circle 
                                key={`${baseKey}-glow-circle`}
                                cx={centerX}
                                cy={centerY}
                                r={radius}
                                fill={color} 
                                filter="url(#glowFilter)"
                                style={{ mixBlendMode: glowSettings.blendMode || 'source-over' }}
                            />
                        );
                    } else {
                        glowPaths.push(
                            <Pixel 
                                key={`${baseKey}-glow`}
                                d={pathData} 
                                fill={color} 
                                filter="url(#glowFilter)"
                                style={{ mixBlendMode: glowSettings.blendMode || 'source-over' }}
                            />
                        );
                    }
                }
                
                // --- Bulb Effect Overlay (if enabled) --- 
                if (bulbEnabled) {
                    // <<< Render correct shape for bulb overlay >>>
                     if (pixelShape === 'circle') {
                        const radius = pixelSize / 2;
                        const centerX = xPos + radius;
                        const centerY = yPos + radius;
                        bulbPaths.push(
                            <circle // <<< Use native circle for bulb
                                key={`${baseKey}-bulb-circle`}
                                cx={centerX}
                                cy={centerY}
                                r={radius}
                                fill="url(#bulbGradient)" 
                                style={{ mixBlendMode: bulbSettings.blendMode || 'screen' }} 
                            />
                        );
                     } else {
                        // <<< Default: Use Pixel path for other shapes >>>
                         bulbPaths.push(
                             <Pixel
                                 key={`${baseKey}-bulb`}
                                 d={pathData}
                                 fill="url(#bulbGradient)" 
                                 style={{ mixBlendMode: bulbSettings.blendMode || 'screen' }} 
                             />
                         );
                     }
                }
            }
        }
    }
    // Return elements layered correctly: Glows -> Crisps -> Bulbs
    return [...glowPaths, ...crispPaths, ...bulbPaths];
  }, [
    pixelData, pixelSize, gridGap, pixelShape, 
    cornerRadius, customShape, visibleArea, 
    glowEnabled, glowSettings, 
    bulbEnabled, bulbSettings, 
    createShapePath
  ]);
  
  // Add transparent interaction layer for empty cells AND colored cells
  const interactionLayer = useMemo(() => {
    // Instead of creating hundreds of individual elements,
    // create a single transparent overlay for the entire grid
    return (
      <InteractionOverlay
        x={0}
        y={0}
        width={totalWidth}
        height={totalHeight}
        onClick={handleClick}
      />
    );
  }, [totalWidth, totalHeight, handleClick]);

  // Add cleanup for the touch timeout
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (touchTimeoutRef.current) {
        clearTimeout(touchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <SVGWrapper>
      <SVGContainer
        ref={svgRef}
        width={totalWidth}
        height={totalHeight}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        preserveAspectRatio="xMinYMin meet"
        $backgroundColor={backgroundColor}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <defs>
          <filter 
            id="glowFilter" 
            x="-50%" // Need extra space for spread/blur/offset
            y="-50%" 
            width="200%" 
            height="200%"
            filterUnits="userSpaceOnUse" 
            colorInterpolationFilters="sRGB" 
          >
            {/* 1. Spread the source graphic */}
            <feMorphology 
              operator="dilate" 
              radius={glowSettings.spread / 100 * pixelSize || 0} 
              in="SourceGraphic" 
              result="spread" 
            />
           
            {/* 2. Offset the spread result */}
            <feOffset 
              dx={glowSettings.offsetX || 0}
              dy={glowSettings.offsetY || 0}
              in="spread" // <<< Input back to "spread"
              result="offset"
            />
            {/* 3. Blur the offset result */}
            <feGaussianBlur 
              // Back to standard blur size calculation
              stdDeviation={(glowSettings.size / 2 || 0)}
              in="offset" 
              result="blurred"
            />
            {/* 4. Control opacity of the blurred result */}
            <feComponentTransfer in="blurred" result="opacityControlled">
              <feFuncA type="linear" slope={glowSettings.opacity / 100 || 0} />
            </feComponentTransfer>
            {/* 5. Merge the original source graphic and the final glow effect */}
            {/* We will handle merging/layering via rendering two paths instead */} 
            {/* But keep a reference for the filter result */}
             <feMerge>
              <feMergeNode in="opacityControlled" /> {/* Explicitly output the glow result */} 
              {/* <feMergeNode in="SourceGraphic" /> */}
             </feMerge>
          </filter>

          {/* Define Bulb Gradient */}
          <radialGradient 
            id="bulbGradient" 
            cx={`${bulbSettings.positionX || 50}%`} 
            cy={`${bulbSettings.positionY || 50}%`} 
            r={`${bulbSettings.radius || 50}%`} 
            gradientUnits="objectBoundingBox" 
            spreadMethod="pad" 
          >
            <stop 
              offset="0%" 
              stopColor={bulbSettings.color || '#ffffff'} 
              stopOpacity={(bulbSettings.intensity || 0) / 100}
            />
            <stop 
              offset="100%" 
              stopColor={bulbSettings.color || '#ffffff'}
              stopOpacity="0"
            />
          </radialGradient>
        </defs>

        {/* Layer for colored pixels */}
        <g className="pixels-layer">
          {renderPixels} {/* Use the new memoized visible pixels */}
        </g>
        
        {/* Transparent layer for interaction */}
        <g className="interaction-layer">
          {interactionLayer}
        </g>
        
        {/* Grid lines on top */}
        {showGrid && (
          <g className="grid-layer">
            {gridLines}
          </g>
        )}
      </SVGContainer>
    </SVGWrapper>
  );
}));

export default SVGRenderer; 