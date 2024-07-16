import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import paper from '@scratch/paper';
import Formats from '../lib/format';
import log from '../log/log';

import {performSnapshot} from '../helper/undo';
import {undoSnapshot, clearUndoState} from '../reducers/undo';
import {isGroup, ungroupItems} from '../helper/group';
import {clearRaster, convertBackgroundGuideLayer, getRaster, setupLayers} from '../helper/layer';
import {clearSelectedItems} from '../reducers/selected-items';
import {
    ART_BOARD_WIDTH, ART_BOARD_HEIGHT, CENTER, MAX_WORKSPACE_BOUNDS,
    clampViewBounds, resetZoom, setWorkspaceBounds, zoomToFit, resizeCrosshair
} from '../helper/view';
import {ensureClockwise, scaleWithStrokes} from '../helper/math';
import {clearHoveredItem} from '../reducers/hover';
import {clearPasteOffset} from '../reducers/clipboard';
import {changeFormat} from '../reducers/format';
import {updateViewBounds} from '../reducers/view-bounds';
import {saveZoomLevel, setZoomLevelId} from '../reducers/zoom-levels';

import styles from './paper-canvas.css';

class PaperCanvas extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'clearQueuedImport',
            'setCanvas',
            'importSvg',
            'initializeSvg',
            'maybeZoomToFit',
            'switchCostume',
            'onViewResize',
            'recalibrateSize',
            'importPreviousCostume'
        ]);
        this.guideLayer = null;
    }

    componentDidMount () {
        paper.setup(this.canvas);
        paper.view.on('resize', this.onViewResize);
        resetZoom();
        if (this.props.zoomLevelId) {
            this.props.setZoomLevelId(this.props.zoomLevelId);
            if (this.props.zoomLevels[this.props.zoomLevelId]) {
                // This is the matrix that the view should be zoomed to after image import
                this.shouldZoomToFit = this.props.zoomLevels[this.props.zoomLevelId];
            } else {
                // Zoom to fit true means find a comfortable zoom level for viewing the costume
                this.shouldZoomToFit = true;
            }
        } else {
            this.props.updateViewBounds(paper.view.matrix);
        }

        const context = this.canvas.getContext('2d');
        context.webkitImageSmoothingEnabled = false;
        context.imageSmoothingEnabled = false;

        // Don't show handles by default
        paper.settings.handleSize = 0;
        // Make layers.
        // potentially pass in prev costume as an arg to render with the background guide layer
        console.log("beep", this.props);
        this.guideLayer = setupLayers(this.props.format, this.props.previousCostume, this.props.prevRotationCenterX, this.props.prevRotationCenterY);
        console.log(this.guideLayer);
        this.importImage(
            this.props.imageFormat, this.props.image, this.props.rotationCenterX, this.props.rotationCenterY);
        /*if (this.props.previousCostume) {
            this.importPreviousCostume(this.props.previousCostume);
        }*/
    }
    componentWillReceiveProps (newProps) {
        if (this.props.imageId !== newProps.imageId) {
            console.log("calling switch costume within will receive props");
            this.switchCostume(newProps.imageFormat, newProps.image,
                newProps.rotationCenterX, newProps.rotationCenterY,
                this.props.zoomLevelId, newProps.zoomLevelId, newProps.prevImageFormat, newProps.previousCostume, newProps.prevRotationCenterX, newProps.prevRotationCenterY);
        }
        console.log("checkthis:");
        // console.log(this.props);
        console.log(newProps);

        //THIS IS WHERE MY ISSUE IS



        if (this.props.format !== newProps.format) {
            this.recalibrateSize();
            convertBackgroundGuideLayer(newProps.format);
        }
        /*if (newProps.previousCostume && newProps.previousCostume !== this.props.previousCostume) {
            this.importPreviousCostume(newProps.previousCostume);
        }*/
    }
    componentWillUnmount () {
        this.clearQueuedImport();
        // shouldZoomToFit means the zoom level hasn't been initialized yet
        if (!this.shouldZoomToFit) {
            this.props.saveZoomLevel();
        }
        paper.remove();
    }
    clearQueuedImport () {
        if (this.queuedImport) {
            window.clearTimeout(this.queuedImport);
            this.queuedImport = null;
        }
        if (this.queuedImageToLoad) {
            this.queuedImageToLoad.src = '';
            this.queuedImageToLoad.onload = null;
            this.queuedImageToLoad = null;
        }
    }
    switchCostume (format, image, rotationCenterX, rotationCenterY, oldZoomLevelId, newZoomLevelId, prevImageFormat, previousCostume, prevRotationCenterX, prevRotationCenterY) {
        console.log("switch");
        if (oldZoomLevelId && oldZoomLevelId !== newZoomLevelId) {
            this.props.saveZoomLevel();
        }
        if (newZoomLevelId && oldZoomLevelId !== newZoomLevelId) {
            if (this.props.zoomLevels[newZoomLevelId]) {
                this.shouldZoomToFit = this.props.zoomLevels[newZoomLevelId];
            } else {
                this.shouldZoomToFit = true;
            }
            this.props.setZoomLevelId(newZoomLevelId);
        }
        for (const layer of paper.project.layers) {
            if (layer.data.isRasterLayer) {
                clearRaster();
            } else if (!layer.data.isBackgroundGuideLayer &&
                !layer.data.isDragCrosshairLayer &&
                !layer.data.isOutlineLayer) {
                layer.removeChildren();
            }
        }
        /* console.log(previousCostume);
        if (previousCostume) {
            console.log("meow");
            // Add a new layer for the previous costume
            const previousCostumeLayer = new paper.Layer();
            previousCostumeLayer.data.isPreviousCostumeLayer = true;
            previousCostumeLayer.opacity = 0.5; // Set opacity for onion skin effect
    
            // Import the previous costume onto the new layer
            this.importPreviousCostume(previousCostume);
    
            // Ensure the previous costume layer is below the current drawing layer
            previousCostumeLayer.sendToBack();
        } */

        this.props.clearUndo();
        this.props.clearSelectedItems();
        this.props.clearHoveredItem();
        this.props.clearPasteOffset();
        if (previousCostume) {
            console.log("trying to add: ",previousCostume);
            console.log("woof, ", this.guideLayer);
            // const previousCostumeRaster = new paper.Raster(previousCostume);
            /*
            const previousCostumeRaster = new paper.Group();
            previousCostumeRaster.addChild(previousCostume);
            console.log("see if this contains anything: ", previousCostumeRaster);
            previousCostumeRaster.position = new paper.Point(prevRotationCenterX, prevRotationCenterY);
            previousCostumeRaster.locked = true; // Lock the raster to make it unmodifiable
            previousCostumeRaster.guide = true; // Mark as guide to ensure it's behind the painting layers
            this.guideLayer.locked = false;
            this.guideLayer.addChild(previousCostumeRaster);
            this.guideLayer.locked = true;
            console.log("woofed?, ", this.guideLayer);*/
        }
        this.importImage(format, image, rotationCenterX, rotationCenterY, prevImageFormat, previousCostume, prevRotationCenterX, prevRotationCenterY);
        /* if (previousCostume) {
            this.importPreviousCostume(previousCostume);
        } */
        // this.importPreviousCostume()
    }
    importImage (format, image, rotationCenterX, rotationCenterY, prevImageFormat, previousCostume, prevRotationCenterX, prevRotationCenterY) {
        // Stop any in-progress imports
        this.clearQueuedImport();

        if (!image) {
            this.props.changeFormat(Formats.VECTOR_SKIP_CONVERT);
            performSnapshot(this.props.undoSnapshot, Formats.VECTOR_SKIP_CONVERT);
            this.recalibrateSize();
            return;
        }
        if (previousCostume) {
            format = prevImageFormat;
        }
        if (format === 'jpg' || format === 'png') {
            // import bitmap
            this.props.changeFormat(Formats.BITMAP_SKIP_CONVERT);

            const mask = new paper.Shape.Rectangle(getRaster().getBounds());
            mask.guide = true;
            mask.locked = true;
            mask.setPosition(CENTER);
            mask.clipMask = true;

            const imgElement = new Image();
            this.queuedImageToLoad = imgElement;
            imgElement.onload = () => {
                if (!this.queuedImageToLoad) return;
                this.queuedImageToLoad = null;

                if (typeof rotationCenterX === 'undefined') {
                    rotationCenterX = imgElement.width / 2;
                }
                if (typeof rotationCenterY === 'undefined') {
                    rotationCenterY = imgElement.height / 2;
                }

                getRaster().drawImage(
                    imgElement,
                    (ART_BOARD_WIDTH / 2) - rotationCenterX,
                    (ART_BOARD_HEIGHT / 2) - rotationCenterY);
                getRaster().drawImage(
                    imgElement,
                    (ART_BOARD_WIDTH / 2) - rotationCenterX,
                    (ART_BOARD_HEIGHT / 2) - rotationCenterY);

                this.maybeZoomToFit(true /* isBitmap */);
                performSnapshot(this.props.undoSnapshot, Formats.BITMAP_SKIP_CONVERT);
                this.recalibrateSize();
            };
            imgElement.src = image;
        } else if (format === 'svg') {
            // handle case where both curr and prev costumes are not both svgs
            this.props.changeFormat(Formats.VECTOR_SKIP_CONVERT);
            if (previousCostume) {
                this.importSvg(previousCostume, prevRotationCenterX, prevRotationCenterY, true);
            }
            this.importSvg(image, rotationCenterX, rotationCenterY, false);
        } else {
            log.error(`Didn't recognize format: ${format}. Use 'jpg', 'png' or 'svg'.`);
            this.props.changeFormat(Formats.VECTOR_SKIP_CONVERT);
            performSnapshot(this.props.undoSnapshot, Formats.VECTOR_SKIP_CONVERT);
            this.recalibrateSize();
        }
    }
    getImageFormat = (filename) => {
        const extension = filename.split('.').pop().toLowerCase();
        if (extension === 'jpg' || extension === 'jpeg') {
            return 'jpg';
        } else if (extension === 'png') {
            return 'png';
        } else if (extension === 'svg') {
            return 'svg';
        } else {
            return null;
        }
    };    
    importPreviousCostume(costume) {
        // Stop any in-progress imports
        this.clearQueuedImport();
        console.log("MEOWWW ", costume);
        if (!costume) {
            this.props.changeFormat(Formats.VECTOR_SKIP_CONVERT);
            performSnapshot(this.props.undoSnapshot, Formats.VECTOR_SKIP_CONVERT);
            this.recalibrateSize();
            return;
        }
        // const format = costume.dataFormat;
        // console.log("format: ", this.getImageFormat(costume));
        // const format = this.getImageFormat(costume);
        // hard code a solution for now....
        const format = "svg";
        // console.log("previous costume props: ", costume)
        // const image = costume.asset.url;
        const rotationCenterX = costume.rotationCenterX;
        const rotationCenterY = costume.rotationCenterY;
    
        if (format === 'jpg' || format === 'png') {
            // Create a new layer for the onion skin
            const onionSkinLayer = new paper.Layer();
            onionSkinLayer.activate();
    
            const imgElement = new Image();
            this.queuedImageToLoad = imgElement;
            imgElement.onload = () => {
                if (!this.queuedImageToLoad) return;
                this.queuedImageToLoad = null;
    
                const raster = new paper.Raster(imgElement);
                raster.opacity = 0.5; // Set opacity for onion skinning
    
                if (typeof rotationCenterX === 'undefined') {
                    rotationCenterX = imgElement.width / 2;
                }
                if (typeof rotationCenterY === 'undefined') {
                    rotationCenterY = imgElement.height / 2;
                }
    
                raster.position = new paper.Point(
                    (ART_BOARD_WIDTH / 2) - rotationCenterX,
                    (ART_BOARD_HEIGHT / 2) - rotationCenterY
                );
    
                // Move the onion skin layer below the current layer
                onionSkinLayer.sendToBack();
            };
            imgElement.src = costume;
        } else if (format === 'svg') {
            this.props.changeFormat(Formats.VECTOR_SKIP_CONVERT);
            this.importSvg(costume, rotationCenterX, rotationCenterY, true);
            // add the previous layer first so that the regular one will be on top
        } else {
            log.error(`Didn't recognize format: ${format}. Use 'jpg', 'png' or 'svg'.`);
        }
    }
    
    maybeZoomToFit (isBitmapMode) {
        if (this.shouldZoomToFit instanceof paper.Matrix) {
            paper.view.matrix = this.shouldZoomToFit;
            this.props.updateViewBounds(paper.view.matrix);
            resizeCrosshair();
        } else if (this.shouldZoomToFit === true) {
            zoomToFit(isBitmapMode);
        }
        this.shouldZoomToFit = false;
        setWorkspaceBounds();
        this.props.updateViewBounds(paper.view.matrix);
    }
    importSvg (svg, rotationCenterX, rotationCenterY, isOnionSkin) {
        const paperCanvas = this;
        // Pre-process SVG to prevent parsing errors (discussion from #213)
        // 1. Remove svg: namespace on elements.
        // TODO: remove
        svg = svg.split(/<\s*svg:/).join('<');
        svg = svg.split(/<\/\s*svg:/).join('</');
        // 2. Add root svg namespace if it does not exist.
        const svgAttrs = svg.match(/<svg [^>]*>/);
        if (svgAttrs && svgAttrs[0].indexOf('xmlns=') === -1) {
            svg = svg.replace(
                '<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
        }

        // Get the origin which the viewBox is defined relative to. During import, Paper will translate
        // the viewBox to start at (0, 0), and we need to translate it back for some costumes to render
        // correctly.
        const parser = new DOMParser();
        const svgDom = parser.parseFromString(svg, 'text/xml');
        const viewBox = svgDom.documentElement.attributes.viewBox ?
            svgDom.documentElement.attributes.viewBox.value.match(/\S+/g) : null;
        if (viewBox) {
            for (let i = 0; i < viewBox.length; i++) {
                viewBox[i] = parseFloat(viewBox[i]);
            }
        }

        paper.project.importSVG(svg, {
            expandShapes: true,
            onLoad: function (item) {
                if (!item) {
                    log.error('SVG import failed:');
                    log.info(svg);
                    this.props.changeFormat(Formats.VECTOR_SKIP_CONVERT);
                    performSnapshot(paperCanvas.props.undoSnapshot, Formats.VECTOR_SKIP_CONVERT);
                    return;
                }
                item.remove();

                // Without the callback, rasters' load function has not been called yet, and they are
                // positioned incorrectly
                paperCanvas.queuedImport = paperCanvas.recalibrateSize(() => {
                    paperCanvas.props.updateViewBounds(paper.view.matrix);
                    paperCanvas.initializeSvg(item, rotationCenterX, rotationCenterY, viewBox, isOnionSkin);
                });
            }
        });
    }
    initializeSvg (item, rotationCenterX, rotationCenterY, viewBox, isOnionSkin) {
        console.log("Current active layer:", paper.project.activeLayer);

        if (this.queuedImport) this.queuedImport = null;
        const itemWidth = item.bounds.width;
        const itemHeight = item.bounds.height;
        /*
        let onionSkinLayer;
        if (isOnionSkin) {
            onionSkinLayer = new paper.Layer();
            onionSkinLayer.name = 'Onion Skin Layer';
            // onionSkinLayer.sendToBack(); // Ensure it's below the active layer
        }*/
        // Get reference to viewbox
        let mask;
        if (item.clipped) {
            for (const child of item.children) {
                if (child.isClipMask()) {
                    mask = child;
                    break;
                }
            }
            mask.clipMask = false;
        } else {
            mask = new paper.Shape.Rectangle(item.bounds);
        }
        mask.guide = true;
        mask.locked = true;
        mask.matrix = new paper.Matrix(); // Identity
        // Set the artwork to get clipped at the max costume size
        mask.size.height = MAX_WORKSPACE_BOUNDS.height;
        mask.size.width = MAX_WORKSPACE_BOUNDS.width;
        mask.setPosition(CENTER);
        // paper.project.activeLayer.addChild(mask);
        /* if (onionSkinLayer) {
            onionSkinLayer.addChild(mask); // Add mask to onion skin layer
        } else {
            paper.project.activeLayer.addChild(mask);
        } */
        if (!isOnionSkin) {
            paper.project.activeLayer.addChild(mask);
        }
        mask.clipMask = true;

        // Reduce single item nested in groups
        if (item instanceof paper.Group && item.children.length === 1) {
            item = item.reduce();
        }

        ensureClockwise(item);
        scaleWithStrokes(item, 2, new paper.Point()); // Import at 2x

        // Apply rotation center
        if (typeof rotationCenterX !== 'undefined' && typeof rotationCenterY !== 'undefined') {
            let rotationPoint = new paper.Point(rotationCenterX, rotationCenterY);
            if (viewBox && viewBox.length >= 2 && !isNaN(viewBox[0]) && !isNaN(viewBox[1])) {
                rotationPoint = rotationPoint.subtract(viewBox[0], viewBox[1]);
            }
            item.translate(CENTER.subtract(rotationPoint.multiply(2)));
        } else {
            // Center
            item.translate(CENTER.subtract(itemWidth, itemHeight));
        }
        const onionSkinOpacity = 0.5;
        const tintColor = new paper.Color(1, 0, 0, 1);
        
        // if (onionSkinLayer) {
        //     onionSkinLayer.addChild(item);
            /* const tintedItem = item.clone();
            tintedItem.fillColor = tintColor;
            tintedItem.opacity = onionSkinOpacity;
            tintedItem.blendMode = 'multiply';
            onionSkinLayer.addChild(tintedItem); */
            // tintRectangle.sendToBack();


            // this is the one that makes them look skinless
            /*
            item.children.forEach(child => {
                child.fillColor = tintColor;
                child.opacity = onionSkinOpacity;
            });*/
            
        //     item.children.forEach(child => {
        //         child.fillColor = tintColor;
        //         child.opacity = 1;
        //         child.blendMode = 'multiply';
        //         child.locked = true;
        //     });
        //     onionSkinLayer.opacity = onionSkinOpacity;
        //     onionSkinLayer.locked = true;
        //     // onionSkinLayer.sendToBack();
        //     onionSkinLayer.data.isBackgroundGuideLayer = true;
        // } else {
        //     paper.project.activeLayer.insertChild(0, item);
        //     paper.project.activeLayer.visible = true;
        // }
        let onionSkinLayer;
        if (isOnionSkin) {
            console.log("meep");
            /* this.guideLayer.locked = false;
            item.opacity = onionSkinOpacity;
            item.fillColor = tintColor;
            this.guideLayer.addChild(item);
            this.guideLayer.locked = true; */
            this.guideLayer.children.forEach(child => {
                if (child.name === 'Onion Skin Layer') {
                    child.remove();
                }
            });
            
            onionSkinLayer = new paper.Layer();
            onionSkinLayer.name = 'Onion Skin Layer';
            onionSkinLayer.addChild(item);
            onionSkinLayer.opacity = onionSkinOpacity;
            this.guideLayer.locked = false;
            this.guideLayer.addChild(onionSkinLayer);
            this.guideLayer.locked = true;
            console.log("guideLayer after most recent add: ", this.guideLayer);
        } else {
            paper.project.activeLayer.insertChild(0, item);
        }
        // paper.project.activeLayer.insertChild(0, item);
        if (isGroup(item)) {
            // Fixes an issue where we may export empty groups
            for (const child of item.children) {
                if (isGroup(child) && child.children.length === 0) {
                    child.remove();
                }
            }
            ungroupItems([item]);
        }

        performSnapshot(this.props.undoSnapshot, Formats.VECTOR_SKIP_CONVERT);
        this.maybeZoomToFit();
    }
    onViewResize () {
        setWorkspaceBounds(true /* clipEmpty */);
        clampViewBounds();
        // Fix incorrect paper canvas scale on browser zoom reset
        this.recalibrateSize();
        this.props.updateViewBounds(paper.view.matrix);
    }
    recalibrateSize (callback) {
        // Sets the size that Paper thinks the canvas is to the size the canvas element actually is.
        // When these are out of sync, the mouse events in the paint editor don't line up correctly.
        return window.setTimeout(() => {
            // If the component unmounts, the canvas will be removed from the page, detaching paper.view.
            // This could also be called before paper.view exists.
            // In either case, return early if so without running the callback.
            if (!paper.view) return;
            // Prevent blurriness caused if the "CSS size" of the element is a float--
            // setting canvas dimensions to floats floors them, but we need to round instead
            const elemSize = paper.DomElement.getSize(paper.view.element);
            elemSize.width = Math.round(elemSize.width);
            elemSize.height = Math.round(elemSize.height);
            paper.view.setViewSize(elemSize);

            if (callback) callback();
        }, 0);
    }
    setCanvas (canvas) {
        this.canvas = canvas;
        if (this.props.canvasRef) {
            this.props.canvasRef(canvas);
        }
    }
    render () {
        return (
            <canvas
                className={styles.paperCanvas}
                ref={this.setCanvas}
                style={{cursor: this.props.cursor}}
                resize="true"
            />
        );
    }
}

PaperCanvas.propTypes = {
    canvasRef: PropTypes.func,
    changeFormat: PropTypes.func.isRequired,
    clearHoveredItem: PropTypes.func.isRequired,
    clearPasteOffset: PropTypes.func.isRequired,
    clearSelectedItems: PropTypes.func.isRequired,
    clearUndo: PropTypes.func.isRequired,
    cursor: PropTypes.string,
    format: PropTypes.oneOf(Object.keys(Formats)),
    image: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(HTMLImageElement)
    ]),
    imageFormat: PropTypes.string, // The incoming image's data format, used during import. The user could switch this.
    imageId: PropTypes.string,
    rotationCenterX: PropTypes.number,
    rotationCenterY: PropTypes.number,
    saveZoomLevel: PropTypes.func.isRequired,
    setZoomLevelId: PropTypes.func.isRequired,
    undoSnapshot: PropTypes.func.isRequired,
    updateViewBounds: PropTypes.func.isRequired,
    zoomLevelId: PropTypes.string,
    zoomLevels: PropTypes.shape({
        currentZoomLevelId: PropTypes.string
    }),
    previousCostume: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(HTMLImageElement)
    ]),
};
const mapStateToProps = state => ({
    mode: state.scratchPaint.mode,
    cursor: state.scratchPaint.cursor,
    format: state.scratchPaint.format,
    zoomLevels: state.scratchPaint.zoomLevels
});
const mapDispatchToProps = dispatch => ({
    undoSnapshot: snapshot => {
        dispatch(undoSnapshot(snapshot));
    },
    clearUndo: () => {
        dispatch(clearUndoState());
    },
    clearSelectedItems: () => {
        dispatch(clearSelectedItems());
    },
    clearHoveredItem: () => {
        dispatch(clearHoveredItem());
    },
    clearPasteOffset: () => {
        dispatch(clearPasteOffset());
    },
    changeFormat: format => {
        dispatch(changeFormat(format));
    },
    saveZoomLevel: () => {
        dispatch(saveZoomLevel(paper.view.matrix));
    },
    setZoomLevelId: zoomLevelId => {
        dispatch(setZoomLevelId(zoomLevelId));
    },
    updateViewBounds: matrix => {
        dispatch(updateViewBounds(matrix));
    }
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(PaperCanvas);
