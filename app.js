// Initialize Canvas and Tools
const canvas = document.getElementById('sketch-canvas');
const ctx = canvas.getContext('2d');
const wrapper = document.getElementById('canvas-wrapper');

// State
let state = {
    entities: [],
    tool: 'select',
    selectedEntityId: null,
    selectedIds: [],
    clipboard: [],
    selectionBox: null,
    isBoxSelecting: false,
    
    // Viewport transforms
    vw: { x: 0, y: 0, z: 1 },
    
    // Interaction states
    isDraggingVp: false,
    isDraggingGrip: null,
    drawingStep: 0, 
    isMovingEntity: false,
    startX: 0, 
    startY: 0,
    tempEntity: null,
    
    // Finite Element Analysis Outputs
    feResults: null,
    activeDiagram: null,
    diagramScale: 1.0,
    hoveredDiagramValue: null, // format: { pt: {x,y}, value: number, label: string }
    mouseWorldPos: null,
    
    gridSize: 20,
    cursorPt: {x: 0, y: 0},
    isTypingDistance: false,
    distanceTrackDir: {x: 1, y: 1}
};

const snapMode = { trackAxis: null, trackRef: null };

// Undo/Redo Stacks
const history = { undo: [], redo: [] };

function saveState() {
    history.undo.push(JSON.stringify(state.entities));
    history.redo = [];
    if (history.undo.length > 50) history.undo.shift();
}

let entityCounter = 0;
const generateId = () => `ent_${++entityCounter}`;

// Resize handler
function resize() {
    canvas.width = wrapper.clientWidth * window.devicePixelRatio;
    canvas.height = wrapper.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    canvas.style.width = `${wrapper.clientWidth}px`;
    canvas.style.height = `${wrapper.clientHeight}px`;
    requestRedraw();
}
window.addEventListener('resize', resize);

// Apply Transformation wrapper for supports/loads that can be rotated
function applyEntityTransform(ctx, ent) {
    ctx.translate(ent.p1.x, ent.p1.y);
    if (ent.angle) ctx.rotate(ent.angle);
}

// GUI Properties Panel Logic
function updatePropertyPanel() {
    const panel = document.getElementById('property-panel');
    if (state.selectedIds.length === 0 || state.tool !== 'select') {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');

    const selectedEnts = state.entities.filter(e => state.selectedIds.includes(e.id));
    if (selectedEnts.length === 0) return;

    const firstType = selectedEnts[0].type;
    const allSameType = selectedEnts.every(e => e.type === firstType);

    if (state.selectedIds.length > 1 && !allSameType) {
        document.getElementById('prop-type-name').innerText = `Multiple Items (${state.selectedIds.length})`;
        
        const containersToHide = [
            'prop-magnitude-container', 'prop-distload-range-container', 'prop-loadheight-container', 'prop-perpload-container',
            'prop-angle-container', 'prop-length-container', 'prop-dim-container', 'prop-beam-rotate-container',
            'prop-text-container', 'prop-line-container', 'prop-arrow-container', 'prop-force-details-container', 'prop-stiffness-container'
        ];
        
        containersToHide.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        return;
    }

    const ent = selectedEnts[0];
    
    // Ensure selectedEntityId aligns with the array for backwards compatibility
    state.selectedEntityId = ent.id;

    if (state.selectedIds.length > 1) {
        document.getElementById('prop-type-name').innerText = `${ent.type.charAt(0).toUpperCase() + ent.type.slice(1)}s (${state.selectedIds.length})`;
    } else {
        document.getElementById('prop-type-name').innerText = ent.type.charAt(0).toUpperCase() + ent.type.slice(1);
    }
    
    const magCont = document.getElementById('prop-magnitude-container');
    const distRangeCont = document.getElementById('prop-distload-range-container');
    const loadHeightCont = document.getElementById('prop-loadheight-container');
    const perpLoadCont = document.getElementById('prop-perpload-container');
    const angCont = document.getElementById('prop-angle-container');
    const lenCont = document.getElementById('prop-length-container');
    const dimCont = document.getElementById('prop-dim-container');
    const beamRotCont = document.getElementById('prop-beam-rotate-container');
    const textCont = document.getElementById('prop-text-container');
    const lineCont = document.getElementById('prop-line-container');
    const arrowCont = document.getElementById('prop-arrow-container');
    const stiffnessCont = document.getElementById('prop-stiffness-container');
    
    magCont.classList.add('hidden');
    distRangeCont.classList.add('hidden');
    perpLoadCont.classList.add('hidden');
    angCont.classList.add('hidden');
    lenCont.classList.add('hidden');
    if (loadHeightCont) loadHeightCont.classList.add('hidden');
    dimCont.classList.add('hidden');
    beamRotCont.classList.add('hidden');
    if (textCont) textCont.classList.add('hidden');
    if (lineCont) lineCont.classList.add('hidden');
    if (arrowCont) arrowCont.classList.add('hidden');
    if (stiffnessCont) stiffnessCont.classList.add('hidden');
    
    if (['force', 'moment', 'distload'].includes(ent.type)) {
        if (ent.type === 'distload') {
            distRangeCont.classList.remove('hidden');
            if (loadHeightCont) loadHeightCont.classList.remove('hidden');
            document.getElementById('prop-distload-start').value = ent.startMagnitude !== undefined ? ent.startMagnitude : (ent.magnitude || '10');
            document.getElementById('prop-distload-end').value = ent.endMagnitude !== undefined ? ent.endMagnitude : (ent.magnitude || '10');
            if (document.getElementById('prop-loadheight')) {
                document.getElementById('prop-loadheight').value = ent.loadHeight !== undefined ? ent.loadHeight : 25;
            }
        } else {
            magCont.classList.remove('hidden');
            document.getElementById('prop-magnitude').value = ent.magnitude || '10';
        }
        
        if (['force', 'distload'].includes(ent.type)) {
            document.getElementById('prop-force-details-container').classList.remove('hidden');
            document.getElementById('prop-force-prefix').value = ent.prefix || '';
            const defaultUnit = ent.type === 'distload' ? 'kN/m' : 'kN';
            
            // Adjust options for force vs distload
            const unitSelect = document.getElementById('prop-force-unit');
            unitSelect.innerHTML = ent.type === 'distload' 
                ? '<option value="kN/m">kN/m</option><option value="N/m">N/m</option><option value="">(None)</option>'
                : '<option value="kN">kN</option><option value="N">N</option><option value="">(None)</option>';
                
            unitSelect.value = ent.unit !== undefined ? ent.unit : defaultUnit;
        } else {
            document.getElementById('prop-force-details-container').classList.add('hidden');
        }
    } else {
        document.getElementById('prop-force-details-container').classList.add('hidden');
    }

    if (['arc', 'parabola'].includes(ent.type)) {
        perpLoadCont.classList.remove('hidden');
        document.getElementById('prop-perpload').value = ent.perpLoad || '';
    }
    
    if (['pin', 'roller', 'fixed', 'spring', 'rotspr', 'textLabel', 'force'].includes(ent.type)) {
        angCont.classList.remove('hidden');
        document.getElementById('prop-angle').value = ent.angle ? Math.round(ent.angle * 180 / Math.PI) : 0;
    }

    if (['spring', 'rotspr'].includes(ent.type)) {
        document.getElementById('prop-stiffness-container').classList.remove('hidden');
        document.getElementById('prop-stiffness').value = ent.stiffness !== undefined ? ent.stiffness : 1000;
        
        if (ent.type === 'rotspr') {
            document.getElementById('prop-stiffness-label').textContent = 'Rotational Stiffness (k)';
            document.getElementById('prop-trans-stiffness-wrapper').classList.add('hidden');
            const unitSpan = document.querySelector('.prop-stiffness-unit');
            if (unitSpan) unitSpan.textContent = 'kNm/rad';
        } else {
            document.getElementById('prop-stiffness-label').textContent = 'Axial Stiffness (k)';
            document.getElementById('prop-trans-stiffness-wrapper').classList.remove('hidden');
            document.getElementById('prop-stiffness-trans').value = ent.stiffnessTrans !== undefined ? ent.stiffnessTrans : 0;
            const unitSpan = document.querySelector('.prop-stiffness-unit');
            if (unitSpan) unitSpan.textContent = 'kN/m';
        }
    }

    if (['beam', 'force'].includes(ent.type)) {
        if (state.selectedIds.length > 1) {
            lenCont.classList.add('hidden');
        } else {
            lenCont.classList.remove('hidden');
            const len = dist(ent.p1, ent.p2) / state.gridSize;
            document.getElementById('prop-length').value = len.toFixed(2);
        }
    }

    if (['beam', 'arc', 'parabola'].includes(ent.type)) {
        beamRotCont.classList.remove('hidden');
        document.getElementById('prop-beam-rot-angle').value = 0;
        
        if (ent.type === 'beam' && document.getElementById('prop-beam-type')) {
            document.getElementById('prop-beam-type').parentElement.classList.remove('hidden');
            document.getElementById('prop-beam-type').value = ent.isTruss ? 'truss' : 'beam';
        } else if (document.getElementById('prop-beam-type')) {
            document.getElementById('prop-beam-type').parentElement.classList.add('hidden');
        }
        
        // Hide absolute coordinates if multiple are selected, otherwise show bounds
        if (document.getElementById('prop-beam-p1-x')) {
            const coordInputs = [
                document.getElementById('prop-beam-p1-x'), document.getElementById('prop-beam-p1-y'),
                document.getElementById('prop-beam-p2-x'), document.getElementById('prop-beam-p2-y')
            ];
            if (state.selectedIds.length > 1) {
                coordInputs.forEach(el => el.parentElement.parentElement.classList.add('hidden'));
            } else {
                coordInputs.forEach(el => el.parentElement.parentElement.classList.remove('hidden'));
                document.getElementById('prop-beam-p1-x').value = (ent.p1.x / state.gridSize).toFixed(2);
                document.getElementById('prop-beam-p1-y').value = (-ent.p1.y / state.gridSize).toFixed(2); // Canvas Y is inverted
                document.getElementById('prop-beam-p2-x').value = (ent.p2.x / state.gridSize).toFixed(2);
                document.getElementById('prop-beam-p2-y').value = (-ent.p2.y / state.gridSize).toFixed(2);
            }
        }
    }

    if (['dimension', 'angdim'].includes(ent.type)) {
        dimCont.classList.remove('hidden');
        document.getElementById('prop-dim-text').value = ent.dimText || '';
        document.getElementById('prop-dim-units').checked = ent.dimUnits !== false; // Default true
        document.getElementById('prop-dim-decimals').value = ent.dimDecimals !== undefined ? ent.dimDecimals : (ent.type === 'angdim' ? 1 : 3);
        document.getElementById('prop-dim-lines').checked = ent.dimLines !== false; // Default true
    }

    if (['textLabel', 'force'].includes(ent.type) && textCont) {
        textCont.classList.remove('hidden');
        if (ent.type === 'textLabel') {
            document.getElementById('prop-text-content-wrapper').classList.remove('hidden');
            document.getElementById('prop-text-content').value = ent.textContent || '';
        } else {
            document.getElementById('prop-text-content-wrapper').classList.add('hidden');
        }
        document.getElementById('prop-text-size').value = ent.textSize || styleSettings[ent.type].text;
        document.getElementById('prop-text-font').value = ent.textFont || 'sans-serif';
        document.getElementById('prop-text-color').value = ent.textColor || styleSettings[ent.type].color || styleSettings[ent.type].rgba;
        document.getElementById('prop-text-bold').checked = ent.textBold !== undefined ? ent.textBold : (ent.type !== 'textLabel');
    }

    if (ent.type === 'line' && lineCont) {
        lineCont.classList.remove('hidden');
        document.getElementById('prop-line-weight').value = ent.weight || 2;
        document.getElementById('prop-line-color').value = ent.color || '#000000';
        document.getElementById('prop-line-dashed').checked = ent.dashed || false;
    }

    if (arrowCont) {
        if (ent.type === 'arrow') {
            arrowCont.classList.remove('hidden');
            document.getElementById('prop-arrow-weight').value = ent.weight || 2;
            document.getElementById('prop-arrow-color').value = ent.color || '#000000';
            document.getElementById('prop-arrow-dashed').checked = ent.dashed || false;
            document.getElementById('prop-arrow-scale').value = ent.arrowScale || 1.0;
        } else {
            arrowCont.classList.add('hidden');
        }
    }
}

function updateSelectedEntities(callback) {
    if (state.selectedIds.length > 0) {
        state.entities.filter(el => state.selectedIds.includes(el.id)).forEach(ent => callback(ent));
        requestRedraw();
    }
}

document.getElementById('prop-magnitude').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        ent.magnitude = e.target.value;
    });
});

document.getElementById('prop-distload-start').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        ent.startMagnitude = e.target.value;
    });
});

document.getElementById('prop-distload-end').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        ent.endMagnitude = e.target.value;
    });
});

if (document.getElementById('prop-loadheight')) {
    document.getElementById('prop-loadheight').addEventListener('input', (e) => {
        updateSelectedEntities(ent => {
            ent.loadHeight = parseFloat(e.target.value) || 25;
        });
    });
}

document.getElementById('prop-force-prefix').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        if (['force', 'distload'].includes(ent.type)) ent.prefix = e.target.value;
    });
});

document.getElementById('prop-force-unit').addEventListener('change', (e) => {
    updateSelectedEntities(ent => {
        if (['force', 'distload'].includes(ent.type)) ent.unit = e.target.value;
    });
});

document.getElementById('prop-perpload').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        ent.perpLoad = e.target.value;
    });
});

document.getElementById('prop-angle').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        ent.angle = parseFloat(e.target.value || 0) * Math.PI / 180;
        if (ent.type === 'force') {
            const len = dist(ent.p1, ent.p2);
            ent.p1 = {
                x: ent.p2.x - len * Math.cos(ent.angle),
                y: ent.p2.y - len * Math.sin(ent.angle)
            };
        }
    });
});

document.getElementById('prop-stiffness').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        if (['spring', 'rotspr'].includes(ent.type)) {
            ent.stiffness = parseFloat(e.target.value) || 0;
        }
    });
});

document.getElementById('prop-stiffness-trans').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        if (ent.type === 'spring') {
            ent.stiffnessTrans = parseFloat(e.target.value) || 0;
        }
    });
});

document.getElementById('prop-length').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        if (['beam', 'force'].includes(ent.type)) {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val >= 0) {
                const realLen = val * state.gridSize;
                if (ent.type === 'beam') {
                    const angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
                    ent.p2 = {
                        x: ent.p1.x + realLen * Math.cos(angle),
                        y: ent.p1.y + realLen * Math.sin(angle)
                    };
                } else if (ent.type === 'force') {
                    ent.p1 = {
                        x: ent.p2.x - realLen * Math.cos(ent.angle !== undefined ? ent.angle : Math.PI / 2),
                        y: ent.p2.y - realLen * Math.sin(ent.angle !== undefined ? ent.angle : Math.PI / 2)
                    };
                }
            }
        }
    });
});

['prop-dim-text', 'prop-dim-units', 'prop-dim-decimals', 'prop-dim-lines'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        updateSelectedEntities(ent => {
            if (['dimension', 'angdim'].includes(ent.type)) {
                if (id === 'prop-dim-text') ent.dimText = e.target.value;
                if (id === 'prop-dim-units') ent.dimUnits = e.target.checked;
                if (id === 'prop-dim-decimals') {
                    const dec = parseInt(e.target.value);
                    ent.dimDecimals = isNaN(dec) ? (ent.type === 'angdim' ? 1 : 3) : dec;
                }
                if (id === 'prop-dim-lines') ent.dimLines = e.target.checked;
            }
        });
    });
});

['prop-text-content', 'prop-text-size', 'prop-text-font', 'prop-text-color', 'prop-text-bold'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
        updateSelectedEntities(ent => {
            if (['textLabel', 'force'].includes(ent.type)) {
                if (id === 'prop-text-content' && ent.type === 'textLabel') ent.textContent = e.target.value;
                if (id === 'prop-text-size') ent.textSize = parseInt(e.target.value);
                if (id === 'prop-text-font') ent.textFont = e.target.value;
                if (id === 'prop-text-color') ent.textColor = e.target.value;
                if (id === 'prop-text-bold') ent.textBold = e.target.checked;
            }
        });
    });
});

['prop-line-weight', 'prop-line-color', 'prop-line-dashed'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = id === 'prop-line-color' ? 'input' : 'change';
    el.addEventListener(eventName, (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'line') {
                if (id === 'prop-line-weight') ent.weight = parseFloat(e.target.value);
                if (id === 'prop-line-color') ent.color = e.target.value;
                if (id === 'prop-line-dashed') ent.dashed = e.target.checked;
            }
        });
    });
});

['prop-arrow-weight', 'prop-arrow-color', 'prop-arrow-dashed', 'prop-arrow-scale'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = id === 'prop-arrow-color' || id === 'prop-arrow-weight' || id === 'prop-arrow-scale' ? 'input' : 'change';
    el.addEventListener(eventName, (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'arrow') {
                if (id === 'prop-arrow-weight') ent.weight = parseFloat(e.target.value);
                if (id === 'prop-arrow-color') ent.color = e.target.value;
                if (id === 'prop-arrow-dashed') ent.dashed = e.target.checked;
                if (id === 'prop-arrow-scale') ent.arrowScale = parseFloat(e.target.value);
            }
        });
    });
});

const typeEl = document.getElementById('prop-beam-type');
if (typeEl) {
    typeEl.addEventListener('change', (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'beam') {
                ent.isTruss = e.target.value === 'truss';
            }
        });
    });
}

['prop-beam-p1-x', 'prop-beam-p1-y', 'prop-beam-p2-x', 'prop-beam-p2-y'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
        updateSelectedEntities(ent => {
            if (['beam', 'arc', 'parabola'].includes(ent.type)) {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    if (id === 'prop-beam-p1-x') ent.p1.x = val * state.gridSize;
                    if (id === 'prop-beam-p1-y') ent.p1.y = -val * state.gridSize; // Y axis is inverted
                    if (id === 'prop-beam-p2-x') ent.p2.x = val * state.gridSize;
                    if (id === 'prop-beam-p2-y') ent.p2.y = -val * state.gridSize;
                }
            }
        });
    });
});

// Attach beam rotation button listener globally
document.getElementById('btn-prop-beam-rotate').addEventListener('click', () => {
    const angleDeg = parseFloat(document.getElementById('prop-beam-rot-angle').value);
    if (isNaN(angleDeg) || angleDeg === 0) return;
    const angleRad = angleDeg * Math.PI / 180;
    const pivotType = document.getElementById('prop-beam-pivot').value;

    saveState();

    updateSelectedEntities(ent => {
        if (!['beam', 'arc', 'parabola'].includes(ent.type)) return;

        let pivot = { x: 0, y: 0 };
        if (pivotType === 'p1') {
            pivot = { ...ent.p1 };
        } else if (pivotType === 'p2') {
            pivot = { ...ent.p2 };
        } else {
            pivot = { x: (ent.p1.x + ent.p2.x) / 2, y: (ent.p1.y + ent.p2.y) / 2 };
        }

        const rotatePoint = (pt, origin, rad) => {
            const dx = pt.x - origin.x;
            const dy = pt.y - origin.y;
            return {
                x: origin.x + dx * Math.cos(rad) - dy * Math.sin(rad),
                y: origin.y + dx * Math.sin(rad) + dy * Math.cos(rad)
            };
        };

        ent.p1 = rotatePoint(ent.p1, pivot, angleRad);
        ent.p2 = rotatePoint(ent.p2, pivot, angleRad);
        if (ent.p3) {
            ent.p3 = rotatePoint(ent.p3, pivot, angleRad);
        }
    });
    
    // reset input
    document.getElementById('prop-beam-rot-angle').value = 0;
    
    // If length changed just loosely due to float math, fix it up
    updatePropertyPanel();
    requestRedraw();
});

// UI Events Setup
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.tool = e.currentTarget.getAttribute('data-tool');
        state.selectedEntityId = null;
        
        // Reset any drawing in progress
        if (state.drawingStep === 1) {
            state.drawingStep = 0;
            state.tempEntity = null;
            document.getElementById('beam-length-panel').classList.add('hidden');
            history.undo.pop();
        }
        
        updatePropertyPanel();
        
        if (state.tool === 'select') canvas.style.cursor = 'default';
        else canvas.style.cursor = 'crosshair';
        requestRedraw();
    });
});

document.addEventListener('keydown', (e) => {
    // Rhino-like CAD input: capture numbers automatically while drawing
    if (e.target.tagName !== 'INPUT' && e.key.length === 1 && /[0-9.-]/.test(e.key)) {
        if (snapMode.trackAxis && snapMode.trackRef && !['select', 'dimension'].includes(state.tool)) {
            // Smart tracking distance configuration has priority when actively tracking an axis!
            state.isTypingDistance = true;
            state.distanceTrackDir = {
                x: Math.sign(state.cursorPt.x - snapMode.trackRef.x) || 1,
                y: Math.sign(state.cursorPt.y - snapMode.trackRef.y) || 1
            };
            const lp = document.getElementById('cad-input-panel');
            const inp = document.getElementById('cad-input');
            document.getElementById('cad-input-label').innerText = 'Distance';
            lp.classList.remove('hidden');
            inp.focus();
            inp.value = e.key;
            e.preventDefault();
            return;
        } else if (state.tempEntity && (
            (state.drawingStep === 1 && ['beam', 'distload', 'dimension'].includes(state.tempEntity.type)) || 
            (state.drawingStep === 2 && ['arc', 'parabola'].includes(state.tempEntity.type))
        )) {
            const inp = document.getElementById('cad-input');
            let label = 'Length';
            if (['arc', 'parabola'].includes(state.tempEntity.type)) label = 'Height/Radius';
            document.getElementById('cad-input-label').innerText = label;
            inp.focus();
            inp.value += e.key;
            e.preventDefault();
            return;
        }
    }

    // Escape action
    if (e.key === 'Escape') {
        if (state.isTypingDistance) {
            state.isTypingDistance = false;
            document.getElementById('cad-input-panel').classList.add('hidden');
            document.getElementById('cad-input').blur();
            requestRedraw();
            return;
        }
        if (state.drawingStep > 0) {
            state.drawingStep = 0;
            state.tempEntity = null;
            document.getElementById('cad-input-panel').classList.add('hidden');
            history.undo.pop(); 
            requestRedraw();
        } else if (state.selectedIds.length > 0 || state.selectedEntityId) {
            state.selectedEntityId = null;
            state.selectedIds = [];
            updatePropertyPanel();
            requestRedraw();
        }
        return;
    }

    // Only interact with keys if we are not actively typing in an input field
    if (e.target.tagName !== 'INPUT' && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (state.selectedIds.length > 0 && state.tool === 'select') {
            state.entities = state.entities.filter(ent => !state.selectedIds.includes(ent.id));
            state.selectedEntityId = null;
            state.selectedIds = [];
            saveState();
            updatePropertyPanel();
            requestRedraw();
        } else if (state.selectedEntityId && state.tool === 'select') {
            state.entities = state.entities.filter(ent => ent.id !== state.selectedEntityId);
            state.selectedEntityId = null;
            saveState();
            updatePropertyPanel();
            requestRedraw();
        }
    }

    // Copy
    if (e.target.tagName !== 'INPUT' && e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (state.selectedIds.length > 0 && state.tool === 'select') {
            state.clipboard = state.entities
                .filter(ent => state.selectedIds.includes(ent.id))
                .map(ent => JSON.parse(JSON.stringify(ent))); // Deep copy
        } else if (state.selectedEntityId && state.tool === 'select') {
            state.clipboard = state.entities
                .filter(ent => ent.id === state.selectedEntityId)
                .map(ent => JSON.parse(JSON.stringify(ent)));
        }
    }

    // Paste
    if (e.target.tagName !== 'INPUT' && e.ctrlKey && e.key.toLowerCase() === 'v') {
        if (state.clipboard.length > 0 && state.tool === 'select') {
            saveState();
            const newIds = [];
            state.clipboard.forEach(ent => {
                const newEnt = JSON.parse(JSON.stringify(ent));
                newEnt.id = generateId();
                // offset slightly by one grid cell (which is state.gridSize visually, but world units is just 1)
                const offset = 1;
                if (newEnt.p1) { newEnt.p1.x += offset; newEnt.p1.y -= offset; }
                if (newEnt.p2) { newEnt.p2.x += offset; newEnt.p2.y -= offset; }
                if (newEnt.p3) { newEnt.p3.x += offset; newEnt.p3.y -= offset; }
                state.entities.push(newEnt);
                newIds.push(newEnt.id);
            });
            state.selectedIds = newIds;
            state.selectedEntityId = newIds[newIds.length - 1];
            updatePropertyPanel();
            requestRedraw();
        }
    }

    // Undo / Redo
    if (e.target.tagName !== 'INPUT' && e.ctrlKey && e.key.toLowerCase() === 'z') triggerUndo();
    if (e.target.tagName !== 'INPUT' && e.ctrlKey && e.key.toLowerCase() === 'y') triggerRedo();
});

document.getElementById('btn-undo').addEventListener('click', triggerUndo);
document.getElementById('btn-redo').addEventListener('click', triggerRedo);
document.getElementById('btn-clear').addEventListener('click', () => {
    saveState();
    state.entities = [];
    state.selectedEntityId = null;
    state.selectedIds = [];
    updatePropertyPanel();
    requestRedraw();
});
document.getElementById('btn-solve').addEventListener('click', () => {
    if (typeof buildFEModel === 'function' && typeof solveFEModel === 'function') {
        const model = buildFEModel(state.entities, state.gridSize);
        console.log("Extracted FE Model:", model);
        
        const results = solveFEModel(model);
        
        const consoleModal = document.getElementById('solver-console-modal');
        const consoleOut = document.getElementById('solver-console-output');
        consoleOut.textContent = '';
        consoleModal.classList.remove('hidden');

        if (results.success) {
            console.log("Solver Results:", results);
            consoleOut.textContent += "System generated successfully.\n\n";
            consoleOut.textContent += "=== NODAL DISPLACEMENTS ===\n";
            
            model.nodes.forEach(n => {
                consoleOut.textContent += `Node ID: ${n.id} (FE X: ${n.x.toFixed(3)}, FE Y: ${n.y.toFixed(3)})\n`;
                consoleOut.textContent += `  Ux: ${(n.ux * 1000).toFixed(5)} mm\n`;
                consoleOut.textContent += `  Uy: ${(n.uy * 1000).toFixed(5)} mm\n`;
                consoleOut.textContent += `  Rz: ${(n.rz * 1000).toFixed(5)} mrad\n\n`;
            });
            
            consoleOut.textContent += "See browser dev console for full internal JSON structures.";
            lucide.createIcons();
            
            // Store results in global state and show results toolbar
            state.feResults = results;
            document.getElementById('results-panel').classList.remove('hidden');
            
        } else {
            console.error("Solver Error:", results.error);
            consoleOut.classList.remove('text-green-400');
            consoleOut.classList.add('text-red-400');
            consoleOut.textContent += "SOLVER ERROR:\n\n" + results.error + "\n\nTip: Make sure supports are fully locking translation, and beam paths form continuous lines.";
        }
    } else {
        alert("Solver script not completely loaded yet.");
    }
});

document.getElementById('btn-close-console').addEventListener('click', () => {
    document.getElementById('solver-console-modal').classList.add('hidden');
    document.getElementById('solver-console-output').className = 'bg-slate-900 text-green-400 p-4 rounded text-xs font-mono max-h-96 overflow-y-auto whitespace-pre-wrap';
});
document.getElementById('btn-dismiss-console').addEventListener('click', () => {
    document.getElementById('solver-console-modal').classList.add('hidden');
    document.getElementById('solver-console-output').className = 'bg-slate-900 text-green-400 p-4 rounded text-xs font-mono max-h-96 overflow-y-auto whitespace-pre-wrap';
});

// FE Results Toggle Logic
document.getElementById('btn-close-results').addEventListener('click', () => {
    state.activeDiagram = null;
    state.feResults = null;
    document.getElementById('results-panel').classList.add('hidden');
    document.querySelectorAll('.diagram-toggle-btn').forEach(b => {
        b.classList.remove('bg-indigo-600', 'text-white');
        b.classList.add('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');
    });
    requestRedraw();
});

document.querySelectorAll('.diagram-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Toggle selected state visually
        document.querySelectorAll('.diagram-toggle-btn').forEach(b => {
            b.classList.remove('bg-indigo-600', 'text-white');
            b.classList.add('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');
        });
        
        const type = e.currentTarget.dataset.diagram;
        
        if (state.activeDiagram === type) {
            state.activeDiagram = null; // Toggle off if clicked again
        } else {
            state.activeDiagram = type;
            e.currentTarget.classList.remove('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');
            e.currentTarget.classList.add('bg-indigo-600', 'text-white');
            
            // If switching to a static diagram (sfd, bmd, afd, disp) and we lost the base model due to influence line
            if (type !== 'influence' && state.feResults && state.feResults.isInfluence) {
                const model = buildFEModel(state.entities, state.gridSize);
                state.feResults = solveFEModel(model);
            }
        }
        requestRedraw();
    });
});

const diagScaleSlider = document.getElementById('diagram-scale-slider');
if (diagScaleSlider) {
    diagScaleSlider.addEventListener('input', (e) => {
        state.diagramScale = parseFloat(e.target.value) || 1.0;
        requestRedraw();
    });
    // Add wheel event to cleanly change scale with mouse scroll when hovering slider
    diagScaleSlider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = parseFloat(diagScaleSlider.step) || 0.1;
        let val = parseFloat(diagScaleSlider.value);
        if (e.deltaY < 0) val += step;
        else val -= step;
        val = Math.max(parseFloat(diagScaleSlider.min), Math.min(parseFloat(diagScaleSlider.max), val));
        diagScaleSlider.value = val;
        state.diagramScale = val;
        requestRedraw();
    });
}

// Project Save / Load Logic
document.getElementById('btn-save-proj').addEventListener('click', async () => {
    const dataStr = JSON.stringify(state.entities);
    
    if (window.showSaveFilePicker) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: 'statics_sketch.json',
                types: [{
                    description: 'JSON Project File',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            const writable = await fileHandle.createWritable();
            await writable.write(dataStr);
            await writable.close();
            return; // Successfully saved
        } catch (err) {
            if (err.name === 'AbortError') return; // User simply cancelled the dialog
            console.warn('File System Access API failed, falling back to download.', err);
        }
    }
    
    // Fallback for browsers that don't support showSaveFilePicker (or if it fails/runs in non-secure context)
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'statics_sketch.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
});

document.getElementById('btn-open-proj').addEventListener('click', () => {
    document.getElementById('file-open-input').click();
});

document.getElementById('file-open-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const loadedEntities = JSON.parse(evt.target.result);
            if (Array.isArray(loadedEntities)) {
                saveState(); // push current to history
                state.entities = loadedEntities;
                state.selectedEntityId = null;
                updatePropertyPanel();
                requestRedraw();
            } else {
                alert('Invalid project file format.');
            }
        } catch (err) {
            alert('Error reading project file.');
            console.error(err);
        }
    };
    reader.readAsText(file);
    // Reset value so the same file could be selected again if needed
    e.target.value = '';
});

// Export Modal Logic
document.getElementById('btn-export').addEventListener('click', () => {
    document.getElementById('export-modal').classList.remove('hidden');
});

document.getElementById('btn-close-export').addEventListener('click', () => {
    document.getElementById('export-modal').classList.add('hidden');
    if (state.tool === 'export-area') document.querySelector('.tool-btn[data-tool=" select\]').click();
});

function doExport(cropBox = null) {
    const isTransparent = document.getElementById('export-transparent').checked;
    const includeRulers = document.getElementById('export-rulers').checked;
    const dpr = window.devicePixelRatio || 1;
    
    // Temporarily disable selection highlights and rulers? (Optional, but let's keep it simple WSIWYG)
    // Actually to get a clean export, let's temporarily hide selections and redraw
    const selId = state.selectedEntityId;
    state.selectedEntityId = null;
    const prevShowGrid = styleSettings.showGrid;
    styleSettings.showGrid = includeRulers;
    
    // Force a sync redraw for export
    const cWidth = wrapper.clientWidth;
    const cHeight = wrapper.clientHeight;
    ctx.clearRect(0, 0, cWidth, cHeight);
    
    ctx.save();
    ctx.translate(state.vw.x, state.vw.y);
    ctx.scale(state.vw.z, state.vw.z);
    
    // Axes
    ctx.beginPath();
    ctx.moveTo(-100000, 0); ctx.lineTo(100000, 0);
    ctx.moveTo(0, -100000); ctx.lineTo(0, 100000);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1 / state.vw.z;
    ctx.stroke();

    ctx.globalAlpha = styleSettings.opacity;
    for (const ent of state.entities) {
        if (!isEntityVisible(ent)) continue;
        EntityLogic[ent.type].draw(ctx, ent, false, false);
    }
    
    if (state.feResults && state.feResults.success && state.activeDiagram && typeof drawFEDiagrams === 'function') {
        drawFEDiagrams(ctx, state.feResults, state.activeDiagram, state.diagramScale, state.mouseWorldPos);
    }
    
    ctx.restore();
    
    // Draw ruler dimensions around GUI if requested
    if (includeRulers) {
        drawGridDimensions(ctx, cWidth, cHeight);
    }

    // Now capture to image
    const expCanvas = document.createElement('canvas');
    let width = canvas.width;
    let height = canvas.height;
    let sx = 0, sy = 0;
    
    if (cropBox) {
        let rsx = Math.min(cropBox.x, cropBox.x + cropBox.w);
        let rsy = Math.min(cropBox.y, cropBox.y + cropBox.h);
        let rw = Math.abs(cropBox.w);
        let rh = Math.abs(cropBox.h);
        
        sx = rsx * dpr;
        sy = rsy * dpr;
        width = rw * dpr;
        height = rh * dpr;
    }
    
    if (width === 0 || height === 0) {
        width = canvas.width; height = canvas.height; sx = 0; sy = 0;
    }

    expCanvas.width = width;
    expCanvas.height = height;
    const eCtx = expCanvas.getContext('2d');
    
    if (!isTransparent) {
        eCtx.fillStyle = styleSettings.bgColor || '#f8fafc';
        eCtx.fillRect(0, 0, width, height);
    }
    
    eCtx.drawImage(canvas, sx, sy, width, height, 0, 0, width, height);
    
    const link = document.createElement('a');
    link.download = 'statics-sketched.png';
    link.href = expCanvas.toDataURL('image/png');
    link.click();

    // Restore state
    state.selectedEntityId = selId;
    styleSettings.showGrid = prevShowGrid;
    requestRedraw();
}

document.getElementById('btn-export-full').addEventListener('click', () => {
    document.getElementById('export-modal').classList.add('hidden');
    doExport(null);
});

document.getElementById('btn-export-area').addEventListener('click', () => {
    document.getElementById('export-modal').classList.add('hidden');
    state.tool = 'export-area'; document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active')); canvas.style.cursor = 'crosshair';
});

// Settings UI Logic
document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
});
document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});

// Visibility Toggles
document.getElementById('vis-structure').addEventListener('change', requestRedraw);
document.getElementById('vis-supports').addEventListener('change', requestRedraw);
document.getElementById('vis-loads').addEventListener('change', requestRedraw);

document.getElementById('setting-snap-master').addEventListener('change', (e) => {
    renderSettings.master = e.target.checked;
    const subOpts = document.getElementById('snapping-sub-options');
    subOpts.style.opacity = renderSettings.master ? '1' : '0.5';
    subOpts.style.pointerEvents = renderSettings.master ? 'auto' : 'none';
});
document.getElementById('setting-snap-grid').addEventListener('change', (e) => renderSettings.grid = e.target.checked);
document.getElementById('setting-snap-endpoints').addEventListener('change', (e) => renderSettings.endpoints = e.target.checked);
document.getElementById('setting-snap-elements').addEventListener('change', (e) => renderSettings.elements = e.target.checked);


function triggerUndo() {
    if (history.undo.length > 0) {
        history.redo.push(JSON.stringify(state.entities));
        state.entities = JSON.parse(history.undo.pop());
        state.selectedEntityId = null;
        updatePropertyPanel();
        requestRedraw();
    }
}

function triggerRedo() {
    if (history.redo.length > 0) {
        history.undo.push(JSON.stringify(state.entities));
        state.entities = JSON.parse(history.redo.pop());
        state.selectedEntityId = null;
        updatePropertyPanel();
        requestRedraw();
    }
}

// CAD Input execution
document.getElementById('cad-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            
            if (state.isTypingDistance) {
                const dist = Math.abs(val) * state.gridSize; // ensure absolute value for dist
                
                // Adjust direction if negative was supplied
                let dirX = state.distanceTrackDir.x;
                let dirY = state.distanceTrackDir.y;
                if (val < 0) {
                    dirX *= -1;
                    dirY *= -1;
                }

                let finalPt = { ...snapMode.trackRef };
                if (snapMode.trackAxis === 'x') {
                    finalPt.x += dist * dirX;
                } else if (snapMode.trackAxis === 'y') {
                    finalPt.y += dist * dirY;
                }
                
                state.isTypingDistance = false;
                document.getElementById('cad-input-panel').classList.add('hidden');
                e.target.value = '';
                e.target.blur();
                
                const sPt = w2s(finalPt);
                const rect = canvas.getBoundingClientRect();
                
                // Fake a mousemove then mousedown to cleanly use the existing logic in one place
                snapMode.bypass = true;
                
                const eventPayload = {
                    clientX: sPt.x + rect.left,
                    clientY: sPt.y + rect.top,
                    button: 0,
                    bubbles: true
                };
                
                window.dispatchEvent(new MouseEvent('mousemove', eventPayload));
                canvas.dispatchEvent(new MouseEvent('mousedown', eventPayload));
                
                snapMode.bypass = false;
                
                requestRedraw();
                return;
            }

            if (val > 0) {
                if (state.drawingStep === 1 && state.tempEntity && ['beam', 'distload', 'dimension'].includes(state.tempEntity.type)) {
                const angle = Math.atan2(state.tempEntity.p2.y - state.tempEntity.p1.y, state.tempEntity.p2.x - state.tempEntity.p1.x);
                const realLen = val * state.gridSize;
                state.tempEntity.p2 = {
                    x: state.tempEntity.p1.x + realLen * Math.cos(angle),
                    y: state.tempEntity.p1.y + realLen * Math.sin(angle)
                };
                
                if (state.tempEntity.type === 'dimension') {
                    // Requires a 3rd click for text placement, so just advance step
                    state.drawingStep = 2;
                    state.tempEntity.p3 = { ...state.tempEntity.p2 };
                } else {
                    state.entities.push({...state.tempEntity});
                    state.selectedEntityId = state.tempEntity.id;
                    state.drawingStep = 0;
                    state.tempEntity = null;
                    document.getElementById('cad-input-panel').classList.add('hidden');
                    
                    document.querySelector('.tool-btn[data-tool="select"]').click();
                    updatePropertyPanel();
                }
                requestRedraw();
            } else if (state.drawingStep === 2 && state.tempEntity && ['arc', 'parabola'].includes(state.tempEntity.type)) {
                let R = val * state.gridSize; // requested radius in pixels
                const pt1 = state.tempEntity.p1;
                const pt2 = state.tempEntity.p2;
                const dx = pt2.x - pt1.x;
                const dy = pt2.y - pt1.y;
                const L = Math.hypot(dx, dy);

                // Cannot form an arc if diameter is less than segment. Clamp it.
                if (R < L / 2) {
                    R = L / 2 + 0.1;
                }
                
                const nx = -dy / L;
                const ny = dx / L;
                const mx = (pt1.x + pt2.x) / 2;
                const my = (pt1.y + pt2.y) / 2;

                const d = Math.sqrt(R * R - (L / 2) * (L / 2));
                
                const p3h = (state.tempEntity.p3.x - mx)*nx + (state.tempEntity.p3.y - my)*ny;
                const side = p3h >= 0 ? 1 : -1;

                const h_val = R - d; 
                
                state.tempEntity.p3 = {
                    x: mx + nx * h_val * side,
                    y: my + ny * h_val * side
                };

                state.entities.push({...state.tempEntity});
                state.selectedEntityId = state.tempEntity.id;
                state.drawingStep = 0;
                state.tempEntity = null;
                document.getElementById('cad-input-panel').classList.add('hidden');
                
                document.querySelector('.tool-btn[data-tool="select"]').click();
                updatePropertyPanel();
                requestRedraw();
            }
        }
    }
}
});

// Math & Drawing Helpers
const w2s = (pt) => ({ x: pt.x * state.vw.z + state.vw.x, y: pt.y * state.vw.z + state.vw.y }); 
const s2w = (pt) => ({ x: (pt.x - state.vw.x) / state.vw.z, y: (pt.y - state.vw.y) / state.vw.z }); 
const dist = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);

// Projection to line segment (returns the projected point)
const projectToLine = (p, v, w) => {
    const l2 = dist(v, w)**2;
    if (l2 === 0) return v;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
};
const distToLine = (p, v, w) => dist(p, projectToLine(p, v, w));

// Settings State
let renderSettings = {
    master: true,
    grid: true,
    endpoints: true,
    elements: true
};

const hexToRgba = (hex, alpha) => {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha !== undefined ? alpha : 1.0})`;
};

let styleSettings = {
    showGrid: true,
    bgColor: '#f8fafc',
    opacity: 1.0,
    beam: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 4 },
    arc: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 4 },
    parabola: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 4 },
    pin: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    roller: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    fixed: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    hinge: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    spring: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    rotspr: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    force: { color: '#e74c3c', alpha: 1.0, rgba: 'rgba(231, 76, 60, 1.0)', weight: 2, text: 12 },
    distload: { color: '#e74c3c', alpha: 1.0, rgba: 'rgba(231, 76, 60, 1.0)', weight: 2, text: 12 },
    moment: { color: '#e74c3c', alpha: 1.0, rgba: 'rgba(231, 76, 60, 1.0)', weight: 2, text: 12 },
    dimension: { color: '#64748b', alpha: 1.0, rgba: 'rgba(100, 116, 139, 1.0)', weight: 1, text: 12 },
    angdim: { color: '#64748b', alpha: 1.0, rgba: 'rgba(100, 116, 139, 1.0)', weight: 1, text: 12 },
    textLabel: { color: '#000000', alpha: 1.0, rgba: 'rgba(0, 0, 0, 1.0)', text: 16 }
};

// UI Style Settings Binding
const buildStyleUI = () => {
    const container = document.getElementById('style-settings-container');
    if (!container) return;
    
    let html = '';
    const keys = Object.keys(styleSettings).filter(k => !['opacity', 'showGrid', 'bgColor'].includes(k));
    
    for (const key of keys) {
        const s = styleSettings[key];
        let label = key.charAt(0).toUpperCase() + key.slice(1);
        if (label === 'Distload') label = 'Dist Load';
        if (label === 'Rotspr') label = 'Rot Spr';
        
        let textInput = '<div class="col-span-2 text-slate-400 text-xs italic text-left pl-1">N/A</div>';
        if (s.text !== undefined) {
             textInput = `<div class="col-span-2 flex items-center gap-1 pl-1">
                                <input type="number" id="style-${key}-text" value="${s.text}" min="8" max="36" class="w-12 border border-slate-300 rounded px-1 py-1 text-sm text-center"> px
                            </div>`;
        }

        html += `
            <div class="grid grid-cols-6 gap-2 items-center text-center">
                <div class="text-sm font-medium text-slate-700 text-left capitalize overflow-hidden whitespace-nowrap" title="${label}">${label}</div>
                <div class="flex justify-center"><input type="color" id="style-${key}-color" value="${s.color}" class="w-7 h-7 p-0 border-0 rounded cursor-pointer"></div>
                <div><input type="number" id="style-${key}-alpha" value="${s.alpha}" min="0" max="1" step="0.1" class="w-full border border-slate-300 rounded px-1 py-1 text-sm text-center"></div>
                <div><input type="number" id="style-${key}-weight" value="${s.weight}" min="1" max="10" class="w-full border border-slate-300 rounded px-1 py-1 text-sm text-center"></div>
                ${textInput}
            </div>
        `;
    }
    container.innerHTML = html;
    
    // Bind global opacity
    const opEl = document.getElementById('setting-style-opacity');
    if(opEl) opEl.addEventListener('input', (e) => {
        styleSettings.opacity = parseFloat(e.target.value);
        requestRedraw();
    });

    // Bind canvas background settings
    const gridEl = document.getElementById('setting-show-grid');
    if (gridEl) {
        gridEl.checked = styleSettings.showGrid;
        gridEl.addEventListener('change', (e) => {
            styleSettings.showGrid = e.target.checked;
            requestRedraw();
        });
    }

    const bgEl = document.getElementById('setting-bg-color');
    if (bgEl) {
        bgEl.value = styleSettings.bgColor;
        bgEl.addEventListener('input', (e) => {
            styleSettings.bgColor = e.target.value;
            requestRedraw();
        });
    }

    // Bind individual values
    for (const key of keys) {
        const bind = (prop, isNum) => {
            const el = document.getElementById(`style-${key}-${prop}`);
            if (el) el.addEventListener('input', (e) => {
                styleSettings[key][prop] = isNum ? parseFloat(e.target.value) : e.target.value;
                if (prop === 'color' || prop === 'alpha') {
                    styleSettings[key].rgba = hexToRgba(styleSettings[key].color, styleSettings[key].alpha);
                }
                requestRedraw();
            });
        };
        bind('color', false);
        bind('alpha', true);
        bind('weight', true);
        if (styleSettings[key].text !== undefined) bind('text', true);
    }
};

buildStyleUI();

const snapRadius = 15;

const snap = (pt) => {
    if (snapMode.bypass) return pt;
    if (!renderSettings.master) return pt;

    // 1. Try Endpoints (supports any entity with p1 or p2: beams, arcs, components)
    if (renderSettings.endpoints) {
        let nearestEP = null;
        let minDistEP = Infinity;
        for (const ent of state.entities) {
            if (ent.p1) {
                const d1 = dist(pt, ent.p1);
                if (d1 < minDistEP && d1 < snapRadius / state.vw.z) {
                    minDistEP = d1;
                    nearestEP = { ...ent.p1 };
                }
            }
            if (ent.p2) {
                const d2 = dist(pt, ent.p2);
                if (d2 < minDistEP && d2 < snapRadius / state.vw.z) {
                    minDistEP = d2;
                    nearestEP = { ...ent.p2 };
                }
            }
        }
        if (nearestEP) {
            snapMode.trackRef = { ...nearestEP };
            snapMode.trackAxis = null;
            return nearestEP;
        }
    }

    // 1.5 Try Ortho Track from Reference Point
    snapMode.trackAxis = null;
    if (snapMode.trackRef) {
        const dx = Math.abs(pt.x - snapMode.trackRef.x);
        const dy = Math.abs(pt.y - snapMode.trackRef.y);
        
        if (dy < snapRadius / state.vw.z) {
            snapMode.trackAxis = 'x';
            let snapped = { x: pt.x, y: snapMode.trackRef.y };
            if (renderSettings.grid) snapped.x = Math.round(snapped.x / state.gridSize) * state.gridSize;
            return snapped;
        } else if (dx < snapRadius / state.vw.z) {
            snapMode.trackAxis = 'y';
            let snapped = { x: snapMode.trackRef.x, y: pt.y };
            if (renderSettings.grid) snapped.y = Math.round(snapped.y / state.gridSize) * state.gridSize;
            return snapped;
        }
    }

    // 2. Try Elements (Beams, Arcs, Parabolas)
    if (renderSettings.elements) {
        let nearestEl = null;
        let minDistEl = Infinity;
        
        const checkLineSegment = (p1, p2) => {
            const proj = projectToLine(pt, p1, p2);
            const d = dist(pt, proj);
            if (d < minDistEl && d < snapRadius / state.vw.z) {
                minDistEl = d;
                nearestEl = proj;
            }
        };

        for (const ent of state.entities) {
            if (ent.type === 'beam') {
                checkLineSegment(ent.p1, ent.p2);
            } else if (ent.type === 'parabola' && ent.p3) {
                const steps = 15;
                let lastPt = ent.p1;
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const u = 1 - t;
                    const x = u*u*ent.p1.x + 2*u*t*ent.p3.x + t*t*ent.p2.x;
                    const y = u*u*ent.p1.y + 2*u*t*ent.p3.y + t*t*ent.p2.y;
                    const ptSegment = { x, y };
                    checkLineSegment(lastPt, ptSegment);
                    lastPt = ptSegment;
                }
            } else if (ent.type === 'arc' && ent.p3) {
                const dx = ent.p2.x - ent.p1.x;
                const dy = ent.p2.y - ent.p1.y;
                const L = Math.hypot(dx, dy);
                if (L > 1e-3) {
                    const nx = -dy / L, ny = dx / L;
                    const mx = (ent.p1.x + ent.p2.x) / 2;
                    const my = (ent.p1.y + ent.p2.y) / 2;
                    const h = (ent.p3.x - mx) * nx + (ent.p3.y - my) * ny;
                    
                    if (Math.abs(h) > 1e-3) {
                        const R = (L * L) / (8 * h) + h / 2;
                        const cx = mx - (R - h) * nx;
                        const cy = my - (R - h) * ny;
                        let startAngle = Math.atan2(ent.p1.y - cy, ent.p1.x - cx);
                        let endAngle = Math.atan2(ent.p2.y - cy, ent.p2.x - cx);
                        
                        const isCCW = h < 0;
                        if (isCCW) {
                            while (endAngle > startAngle) endAngle -= Math.PI * 2;
                        } else {
                            while (endAngle < startAngle) endAngle += Math.PI * 2;
                        }
                        
                        const steps = 15;
                        let lastPt = ent.p1;
                        for (let i = 1; i <= steps; i++) {
                            const ang = startAngle + (endAngle - startAngle) * (i / steps);
                            const ptSegment = { x: cx + Math.abs(R) * Math.cos(ang), y: cy + Math.abs(R) * Math.sin(ang) };
                            if (i === steps) { ptSegment.x = ent.p2.x; ptSegment.y = ent.p2.y; }
                            checkLineSegment(lastPt, ptSegment);
                            lastPt = ptSegment;
                        }
                    } else {
                        checkLineSegment(ent.p1, ent.p2);
                    }
                }
            }
        }
        if (nearestEl) return nearestEl;
    }

    // 3. Fallback to Grid
    if (renderSettings.grid) {
        return {
            x: Math.round(pt.x / state.gridSize) * state.gridSize,
            y: Math.round(pt.y / state.gridSize) * state.gridSize
        };
    }
    
    return pt;
};

function drawHatching(ctx, xc, yc, width) {
    ctx.lineWidth = 1;
    const startX = xc - width/2;
    for(let i=0; i<=width; i+=6) {
        ctx.beginPath();
        ctx.moveTo(startX + i, yc);
        ctx.lineTo(startX + i - 4, yc + 6);
        ctx.stroke();
    }
}

function drawTextMagnitude(ctx, text, color, x, y, options = {}) {
    if (!text || text === '0') return;
    ctx.save();
    ctx.setTransform(state.vw.z, 0, 0, state.vw.z, state.vw.x, state.vw.y);
    const size = options.size || 12;
    const font = options.font || 'sans-serif';
    const boldStr = options.bold === false ? '' : (options.bold || true ? 'bold ' : 'bold '); // default bold backwards compatible? Actually let's make it respect what is passed. But existing caller assumes bold by default. Let's say if options.bold is provided, use it, else bold.
    const fontWeight = options.bold !== undefined ? (options.bold ? 'bold ' : '') : 'bold ';
    ctx.font = `${fontWeight}${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(`${text}`, x + 8, y - 8);
    ctx.restore();
}

// Entity rendering and logic functions
const EntityLogic = {
    arrow: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const headlen = 15 * (ent.arrowScale || 1.0);
            const angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
            
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            ctx.lineTo(ent.p2.x - headlen * Math.cos(angle - Math.PI / 6), ent.p2.y - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(ent.p2.x, ent.p2.y);
            ctx.lineTo(ent.p2.x - headlen * Math.cos(angle + Math.PI / 6), ent.p2.y - headlen * Math.sin(angle + Math.PI / 6));
            
            ctx.strokeStyle = isSelected ? '#3b82f6' : (ent.color || '#000000');
            ctx.lineWidth = isSelected ? (ent.weight || 2) + 1 : (ent.weight || 2);

            if (ent.dashed) {
                ctx.setLineDash([6, 6]);
            }
            if (isPreview) {
                ctx.strokeStyle = '#94a3b8';
                ctx.setLineDash([4, 4]);
            }

            ctx.stroke();
            ctx.restore();
        },
        hitTest: (pt, ent) => distToLine(pt, ent.p1, ent.p2) < 8 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; ent.p2.x += dx; ent.p2.y += dy; }
    },
    line: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            
            ctx.strokeStyle = isSelected ? '#3b82f6' : (ent.color || '#000000');
            ctx.lineWidth = ent.weight || 2;
            
            if (ent.dashed) {
                ctx.setLineDash([6, 6]);
            }
            if (isPreview) {
                ctx.strokeStyle = '#94a3b8';
                ctx.setLineDash([4, 4]);
            }
            ctx.stroke();
            ctx.restore();
        },
        hitTest: (pt, ent) => {
            const proj = projectToLine(pt, ent.p1, ent.p2);
            return dist(proj, pt) < 6 / state.vw.z;
        },
        move: (ent, dx, dy) => {
            ent.p1.x += dx; ent.p1.y += dy;
            ent.p2.x += dx; ent.p2.y += dy;
        }
    },
    beam: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = isSelected ? styleSettings[ent.type].weight + 1 : styleSettings[ent.type].weight;
            
            if (isPreview) {
                ctx.setLineDash([8, 6]);
                ctx.strokeStyle = '#94a3b8'; // Lighter dash for preview
            }
            ctx.stroke();
            
            ctx.beginPath(); ctx.arc(ent.p1.x, ent.p1.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
            ctx.beginPath(); ctx.arc(ent.p2.x, ent.p2.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
            ctx.restore();

            if (isPreview && (ent.p1.x !== ent.p2.x || ent.p1.y !== ent.p2.y)) {
                const length = dist(ent.p1, ent.p2) / state.gridSize;
                if (length > 0) {
                    const midX = (ent.p1.x + ent.p2.x) / 2;
                    const midY = (ent.p1.y + ent.p2.y) / 2;
                    ctx.save();
                    const angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
                    ctx.translate(midX, midY);
                    if (Math.abs(angle) > Math.PI/2) {
                        ctx.rotate(angle + Math.PI);
                        ctx.translate(0, -10);
                    } else {
                        ctx.rotate(angle);
                        ctx.translate(0, -10);
                    }
                    ctx.font = `600 ${styleSettings[ent.type].text}px sans-serif`;
                    ctx.fillStyle = '#3b82f6';
                    ctx.textAlign = 'center';
                    ctx.fillText(`L = ${length.toFixed(2)}m`, 0, 0);
                    ctx.restore();
                }
            }
        },
        hitTest: (pt, ent) => distToLine(pt, ent.p1, ent.p2) < 8 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; ent.p2.x += dx; ent.p2.y += dy; }
    },
    arc: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            ctx.beginPath();
            
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = isSelected ? styleSettings[ent.type].weight + 1 : styleSettings[ent.type].weight;
            if (isPreview) {
                ctx.setLineDash([8, 6]);
                ctx.strokeStyle = '#94a3b8';
            }

            if (!ent.p3) {
                ctx.moveTo(ent.p1.x, ent.p1.y);
                ctx.lineTo(ent.p2.x, ent.p2.y);
                ctx.stroke();
            } else {
                const dx = ent.p2.x - ent.p1.x;
                const dy = ent.p2.y - ent.p1.y;
                const L = Math.hypot(dx, dy);
                
                if (L < 1e-3) {
                    ctx.moveTo(ent.p1.x, ent.p1.y);
                    ctx.lineTo(ent.p2.x, ent.p2.y);
                    ctx.stroke();
                } else {
                    const nx = -dy / L, ny = dx / L;
                    const mx = (ent.p1.x + ent.p2.x) / 2;
                    const my = (ent.p1.y + ent.p2.y) / 2;
                    
                    const h = (ent.p3.x - mx) * nx + (ent.p3.y - my) * ny;
                    if (Math.abs(h) < 1e-3) {
                        ctx.moveTo(ent.p1.x, ent.p1.y);
                        ctx.lineTo(ent.p2.x, ent.p2.y);
                        ctx.stroke();
                    } else {
                        const R = (L * L) / (8 * h) + h / 2;
                        const cx = mx - (R - h) * nx;
                        const cy = my - (R - h) * ny;
                        const startAngle = Math.atan2(ent.p1.y - cy, ent.p1.x - cx);
                        const endAngle = Math.atan2(ent.p2.y - cy, ent.p2.x - cx);
                        
                        ctx.arc(cx, cy, Math.abs(R), startAngle, endAngle, h < 0);
                        ctx.stroke();

                        // Draw radius preview
                        if (isSelected || (isPreview && state.drawingStep === 2)) {
                            ctx.setLineDash([4, 4]);
                            ctx.lineWidth = 1;
                            ctx.strokeStyle = '#94a3b8';
                            ctx.beginPath();
                            ctx.moveTo(cx, cy);
                            ctx.lineTo(ent.p3.x, ent.p3.y);
                            ctx.stroke();
                            
                            const rUnits = (Math.abs(R) / state.gridSize).toFixed(2) + 'm';
                            ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
                            ctx.fillStyle = ctx.strokeStyle;
                            ctx.textAlign = 'center';
                            
                            // Center on the radius line
                            const txtX = cx + (ent.p3.x - cx)/2;
                            const txtY = cy + (ent.p3.y - cy)/2;
                            
                            let textAngle = Math.atan2(ent.p3.y - cy, ent.p3.x - cx);
                            if (Math.abs(textAngle) > Math.PI/2) textAngle += Math.PI;
                            
                            ctx.save();
                            ctx.translate(txtX, txtY);
                            ctx.rotate(textAngle);
                            ctx.fillText('R=' + rUnits, 0, -5);
                            ctx.restore();
                        }
                    }
                }
            }
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(ent.p1.x, ent.p1.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
            ctx.beginPath(); ctx.arc(ent.p2.x, ent.p2.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();

            // Draw Perpendicular Load
            if (ent.perpLoad && parseFloat(ent.perpLoad) !== 0 && (!isPreview || state.drawingStep === 0)) {
                const loadHeight = 25;
                const loadDir = parseFloat(ent.perpLoad) > 0 ? 1 : -1; // positive = points to curve
                ctx.strokeStyle = styleSettings[ent.type].rgba;
                ctx.lineWidth = styleSettings[ent.type].weight;
                
                const dx = ent.p2.x - ent.p1.x;
                const dy = ent.p2.y - ent.p1.y;
                const L = Math.hypot(dx, dy);
                
                if (L > 1e-3 && ent.p3) {
                    const nx = -dy / L, ny = dx / L;
                    const mx = (ent.p1.x + ent.p2.x) / 2;
                    const my = (ent.p1.y + ent.p2.y) / 2;
                    const h = (ent.p3.x - mx) * nx + (ent.p3.y - my) * ny;
                    
                    if (Math.abs(h) > 1e-3) {
                        const R = (L * L) / (8 * h) + h / 2;
                        const cx = mx - (R - h) * nx;
                        const cy = my - (R - h) * ny;
                        
                        let startAngle = Math.atan2(ent.p1.y - cy, ent.p1.x - cx);
                        let endAngle = Math.atan2(ent.p2.y - cy, ent.p2.x - cx);
                        
                        // Ensure correct angular distance based on arc render (h < 0)
                        let dAngle = endAngle - startAngle;
                        if (h < 0) {
                            if (dAngle > 0) dAngle -= Math.PI * 2;
                        } else {
                            if (dAngle < 0) dAngle += Math.PI * 2;
                        }

                        const arcLen = Math.abs(R * dAngle);
                        const steps = Math.max(3, Math.floor(arcLen / 20));
                        
                        // Draw connecting top curve
                        ctx.beginPath();
                        for (let i = 0; i <= steps; i++) {
                            const ang = startAngle + (i / steps) * dAngle;
                            // normal vector points OUTWARD from center
                            const pnx = Math.cos(ang);
                            const pny = Math.sin(ang);
                            
                            // The direction of the normal must be aligned with how the user perceives "outside".
                            // Usually, positive load on an arch pushes it down (towards center if h > 0)
                            // If h>0, center is below. So normal pointing out (pnx, pny) would be *up*.
                            // We construct it systematically:
                            const outDirX = pnx * Math.sign(h);
                            const outDirY = pny * Math.sign(h);
                            
                            const px = cx + pnx * Math.abs(R);
                            const py = cy + pny * Math.abs(R);
                            const tx = px + outDirX * loadHeight * loadDir;
                            const ty = py + outDirY * loadHeight * loadDir;
                            if (i === 0) ctx.moveTo(tx, ty);
                            else ctx.lineTo(tx, ty);
                        }
                        ctx.stroke();

                        // Draw arrows
                        for (let i = 0; i <= steps; i++) {
                            const ang = startAngle + (i / steps) * dAngle;
                            const pnx = Math.cos(ang);
                            const pny = Math.sin(ang);
                            const outDirX = pnx * Math.sign(h);
                            const outDirY = pny * Math.sign(h);
                            
                            const px = cx + pnx * Math.abs(R);
                            const py = cy + pny * Math.abs(R);
                            const tx = px + outDirX * loadHeight * loadDir;
                            const ty = py + outDirY * loadHeight * loadDir;
                            
                            ctx.beginPath();
                            ctx.moveTo(tx, ty);
                            ctx.lineTo(px, py);
                            ctx.stroke();
                            
                            // Arrow head at px,py (if pointing towards curve) or tx,ty
                            const arrowBaseX = loadDir > 0 ? px : tx;
                            const arrowBaseY = loadDir > 0 ? py : ty;
                            // the vector of the arrow shaft
                            const vx = loadDir > 0 ? -outDirX : outDirX;
                            const vy = loadDir > 0 ? -outDirY : outDirY;
                            
                            const al = 6;
                            const aw = 3;
                            ctx.beginPath();
                            ctx.moveTo(arrowBaseX, arrowBaseY);
                            ctx.lineTo(arrowBaseX - vx * al + vy * aw, arrowBaseY - vy * al - vx * aw);
                            ctx.moveTo(arrowBaseX, arrowBaseY);
                            ctx.lineTo(arrowBaseX - vx * al - vy * aw, arrowBaseY - vy * al + vx * aw);
                            ctx.stroke();
                        }

                        // Text
                        const textAng = startAngle + dAngle / 2;
                        const pnx = Math.cos(textAng);
                        const pny = Math.sin(textAng);
                        const outDirX = pnx * Math.sign(h);
                        const outDirY = pny * Math.sign(h);
                        
                        const midPx = cx + pnx * Math.abs(R);
                        const midPy = cy + pny * Math.abs(R);
                        const textOffset = loadHeight * loadDir + (loadDir > 0 ? 10 : -10);
                        const textX = midPx + outDirX * textOffset;
                        const textY = midPy + outDirY * textOffset;

                        ctx.save();
                        ctx.translate(textX, textY);
                        let rotAng = textAng;
                        if (Math.abs(rotAng) > Math.PI/2) rotAng += Math.PI;
                        ctx.rotate(rotAng);
                        ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
                        ctx.fillStyle = ctx.strokeStyle;
                        ctx.textAlign = 'center';
                        ctx.fillText(Math.abs(parseFloat(ent.perpLoad)) + ' kN/m', 0, 0);
                        ctx.restore();
                    }
                }
            }

            ctx.restore();
        },
        hitTest: (pt, ent) => {
            const dx = ent.p2.x - ent.p1.x;
            const dy = ent.p2.y - ent.p1.y;
            const L = Math.hypot(dx, dy);
            if (L < 1e-3) return dist(pt, ent.p1) < 10 / state.vw.z;
            if (!ent.p3) return distToLine(pt, ent.p1, ent.p2) < 10 / state.vw.z;
            
            const nx = -dy / L, ny = dx / L;
            const mx = (ent.p1.x + ent.p2.x) / 2;
            const my = (ent.p1.y + ent.p2.y) / 2;
            const h = (ent.p3.x - mx) * nx + (ent.p3.y - my) * ny;
            
            if (Math.abs(h) < 1e-3) return distToLine(pt, ent.p1, ent.p2) < 10 / state.vw.z;
            
            const R = (L * L) / (8 * h) + h / 2;
            const cx = mx - (R - h) * nx;
            const cy = my - (R - h) * ny;
            
            if (Math.abs(dist(pt, {x: cx, y: cy}) - Math.abs(R)) > 10 / state.vw.z) return false;
            
            const norm = (a, ref) => { let d = a - ref; while(d <= 0) d += Math.PI*2; while(d > Math.PI*2) d -= Math.PI*2; return d; };
            const nA = norm(Math.atan2(pt.y - cy, pt.x - cx), Math.atan2(ent.p1.y - cy, ent.p1.x - cx));
            const nA2 = norm(Math.atan2(ent.p2.y - cy, ent.p2.x - cx), Math.atan2(ent.p1.y - cy, ent.p1.x - cx));
            const nA3 = norm(Math.atan2(ent.p3.y - cy, ent.p3.x - cx), Math.atan2(ent.p1.y - cy, ent.p1.x - cx));
            
            if (nA3 < nA2) return nA <= nA2;
            else return nA >= nA2;
        },
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; ent.p2.x += dx; ent.p2.y += dy; if (ent.p3) { ent.p3.x += dx; ent.p3.y += dy; } }
    },
    parabola: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            if (ent.p3) {
                ctx.quadraticCurveTo(ent.p3.x, ent.p3.y, ent.p2.x, ent.p2.y); 
            } else {
                ctx.lineTo(ent.p2.x, ent.p2.y);
            }
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = isSelected ? styleSettings[ent.type].weight + 1 : styleSettings[ent.type].weight;
            if (isPreview) {
                ctx.setLineDash([8, 6]);
                ctx.strokeStyle = '#94a3b8';
            }
            ctx.stroke();
            ctx.beginPath(); ctx.arc(ent.p1.x, ent.p1.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
            ctx.beginPath(); ctx.arc(ent.p2.x, ent.p2.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
            
            // Draw Perpendicular Load for Parabola
            if (ent.perpLoad && parseFloat(ent.perpLoad) !== 0 && ent.p3 && (!isPreview || state.drawingStep === 0)) {
                const loadHeight = 25;
                const loadDir = parseFloat(ent.perpLoad) > 0 ? 1 : -1;
                ctx.strokeStyle = styleSettings[ent.type].rgba;
                ctx.lineWidth = styleSettings[ent.type].weight * 0.5 || 1;
                ctx.setLineDash([]);
                
                const steps = 15;
                
                // Get points and normals
                const pts = [];
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const u = 1 - t;
                    const x = u*u*ent.p1.x + 2*u*t*ent.p3.x + t*t*ent.p2.x;
                    const y = u*u*ent.p1.y + 2*u*t*ent.p3.y + t*t*ent.p2.y;
                    
                    // Derivative to find normal
                    const dx = 2*u*(ent.p3.x - ent.p1.x) + 2*t*(ent.p2.x - ent.p3.x);
                    const dy = 2*u*(ent.p3.y - ent.p1.y) + 2*t*(ent.p2.y - ent.p3.y);
                    const len = Math.hypot(dx, dy);
                    const nx = dy / len;  // normal x
                    const ny = -dx / len; // normal y (pointing "up" inside vertex if drawn normally)
                    
                    pts.push({ x, y, nx, ny });
                }

                // Top load curve
                ctx.beginPath();
                for (let i = 0; i <= steps; i++) {
                    const p = pts[i];
                    const tx = p.x + p.nx * loadHeight * loadDir;
                    const ty = p.y + p.ny * loadHeight * loadDir;
                    if (i === 0) ctx.moveTo(tx, ty);
                    else ctx.lineTo(tx, ty);
                }
                ctx.stroke();

                // Arrows
                for (let i = 0; i <= steps; i++) {
                    const p = pts[i];
                    const tx = p.x + p.nx * loadHeight * loadDir;
                    const ty = p.y + p.ny * loadHeight * loadDir;
                    
                    ctx.beginPath();
                    ctx.moveTo(tx, ty);
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                    
                    const arrowBaseX = loadDir > 0 ? p.x : tx;
                    const arrowBaseY = loadDir > 0 ? p.y : ty;
                    
                    // Shaft vector
                    const vx = loadDir > 0 ? -p.nx : p.nx;
                    const vy = loadDir > 0 ? -p.ny : p.ny;
                    
                    const al = 6;
                    const aw = 3;
                    ctx.beginPath();
                    ctx.moveTo(arrowBaseX, arrowBaseY);
                    ctx.lineTo(arrowBaseX - vx * al + vy * aw, arrowBaseY - vy * al - vx * aw);
                    ctx.moveTo(arrowBaseX, arrowBaseY);
                    ctx.lineTo(arrowBaseX - vx * al - vy * aw, arrowBaseY - vy * al + vx * aw);
                    ctx.stroke();
                }

                // Text
                const midIdx = Math.floor(steps / 2);
                const mp = pts[midIdx];
                const textOffset = loadHeight * loadDir + (loadDir > 0 ? 10 : -10);
                const textX = mp.x + mp.nx * textOffset;
                const textY = mp.y + mp.ny * textOffset;

                ctx.save();
                ctx.translate(textX, textY);
                let rotAng = Math.atan2(mp.ny, mp.nx) + Math.PI/2;
                if (Math.abs(rotAng) > Math.PI/2) rotAng += Math.PI;
                ctx.rotate(rotAng);
                ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
                ctx.fillStyle = ctx.strokeStyle;
                ctx.textAlign = 'center';
                ctx.fillText(Math.abs(parseFloat(ent.perpLoad)) + ' kN/m', 0, 0);
                ctx.restore();
            }

            ctx.restore();
        },
        hitTest: (pt, ent) => {
            if (!ent.p3) return distToLine(pt, ent.p1, ent.p2) < 10 / state.vw.z;
            let minDist = Infinity;
            for(let i=0; i<=10; i++) {
                const t = i/10;
                const u = 1-t;
                const x = u*u*ent.p1.x + 2*u*t*ent.p3.x + t*t*ent.p2.x;
                const y = u*u*ent.p1.y + 2*u*t*ent.p3.y + t*t*ent.p2.y;
                minDist = Math.min(minDist, dist(pt, {x, y}));
            }
            return minDist < 15 / state.vw.z;
        },
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; ent.p2.x += dx; ent.p2.y += dy; if (ent.p3) { ent.p3.x += dx; ent.p3.y += dy; } }
    },
    force: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const headlen = 15;
            const angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
            
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            ctx.lineTo(ent.p2.x - headlen * Math.cos(angle - Math.PI / 6), ent.p2.y - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(ent.p2.x, ent.p2.y);
            ctx.lineTo(ent.p2.x - headlen * Math.cos(angle + Math.PI / 6), ent.p2.y - headlen * Math.sin(angle + Math.PI / 6));
            
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;

            if (isPreview) {
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = '#fca5a5';
            }

            ctx.stroke();
            ctx.restore();
            
            if (!isPreview) {
                let textStr = ent.magnitude || '10';
                const unitStr = ent.unit !== undefined ? ent.unit : 'kN';
                if (ent.prefix && ent.prefix.trim() !== '') {
                    textStr = `${ent.prefix} = ${textStr} ${unitStr}`;
                } else if (unitStr !== '') {
                    textStr = `${textStr} ${unitStr}`;
                }
                drawTextMagnitude(ctx, textStr, isSelected ? '#3b82f6' : (ent.textColor || styleSettings[ent.type].rgba), ent.p1.x, ent.p1.y, {
                    size: ent.textSize || styleSettings[ent.type].text,
                    font: ent.textFont || 'sans-serif',
                    bold: ent.textBold !== undefined ? ent.textBold : true
                });
            }
        },
        hitTest: (pt, ent) => distToLine(pt, ent.p1, ent.p2) < 8 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; ent.p2.x += dx; ent.p2.y += dy; }
    },
    distload: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight * 0.5 || 1; // slightly thinner for dist load lines
            if (isPreview && state.drawingStep === 1) {
                ctx.setLineDash([4, 4]);
            }
            ctx.stroke();

            const dx = ent.p2.x - ent.p1.x;
            const dy = ent.p2.y - ent.p1.y;
            const len = Math.hypot(dx, dy);
            
            if (len > 0) {
                const nx = -dy / len;
                const ny = dx / len;
                const baseHeight = ent.loadHeight !== undefined ? ent.loadHeight : 25;
                const hStart = baseHeight * (ent.startMagnitude !== undefined ? parseFloat(ent.startMagnitude) / Math.max(parseFloat(ent.startMagnitude), parseFloat(ent.endMagnitude || ent.startMagnitude), 1) : 1); 
                const hEnd = baseHeight * (ent.endMagnitude !== undefined ? parseFloat(ent.endMagnitude) / Math.max(parseFloat(ent.startMagnitude || 10), parseFloat(ent.endMagnitude), 1) : 1);
                
                ctx.beginPath();
                ctx.moveTo(ent.p1.x - nx * hStart, ent.p1.y - ny * hStart);
                ctx.lineTo(ent.p2.x - nx * hEnd, ent.p2.y - ny * hEnd);
                ctx.stroke();

                const steps = Math.max(2, Math.floor(len / 15));
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const h = hStart * (1 - t) + hEnd * t;
                    const px = ent.p1.x + dx * t;
                    const py = ent.p1.y + dy * t;
                    
                    ctx.beginPath();
                    ctx.moveTo(px - nx * h, py - ny * h);
                    ctx.lineTo(px, py);
                    ctx.stroke();
                    
                    // Arrow head
                    const al = 6;
                    const aw = 3;
                    ctx.beginPath();
                    ctx.moveTo(px, py);
                    ctx.lineTo(px - nx * al + ny * aw, py - ny * al - nx * aw);
                    ctx.moveTo(px, py);
                    ctx.lineTo(px - nx * al - ny * aw, py - ny * al + nx * aw);
                    ctx.stroke();
                }

                // Text
                let textStr = ent.magnitude || '10';
                if (ent.startMagnitude !== undefined && ent.endMagnitude !== undefined) {
                    textStr = ent.startMagnitude === ent.endMagnitude ? ent.startMagnitude : `${ent.startMagnitude} to ${ent.endMagnitude}`;
                }
                const unitStr = ent.unit !== undefined ? ent.unit : 'kN/m';
                if (ent.prefix && ent.prefix.trim() !== '') {
                    textStr = `${ent.prefix} = ${textStr} ${unitStr}`;
                } else if (unitStr !== '') {
                    textStr = `${textStr} ${unitStr}`;
                }

                const midX = (ent.p1.x + ent.p2.x) / 2;
                const midY = (ent.p1.y + ent.p2.y) / 2;
                const midH = (hStart + hEnd) / 2;
                
                ctx.translate(midX - nx * (midH + 8), midY - ny * (midH + 8));
                let angle = Math.atan2(dy, dx);
                if (Math.abs(angle) > Math.PI/2) angle += Math.PI;
                ctx.rotate(angle);
                ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
                ctx.fillStyle = ctx.strokeStyle;
                ctx.textAlign = 'center';
                ctx.fillText(textStr, 0, 0);
            }
            ctx.restore();
        },
        hitTest: (pt, ent) => distToLine(pt, ent.p1, ent.p2) < 15 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; ent.p2.x += dx; ent.p2.y += dy; }
    },
    moment: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.beginPath();
            ctx.arc(0, 0, 25, 0, Math.PI * 1.5, false); // 270 deg arc
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;
            ctx.stroke();

            // Arrow head (pointing right to follow the clockwise arc)
            ctx.beginPath();
            ctx.moveTo(0, -25);
            ctx.lineTo(-8, -32);
            ctx.moveTo(0, -25);
            ctx.lineTo(-8, -18);
            ctx.stroke();
            ctx.restore();

            drawTextMagnitude(ctx, ent.magnitude, isSelected ? '#3b82f6' : styleSettings[ent.type].rgba, ent.p1.x + 25, ent.p1.y - 25, { size: styleSettings[ent.type].text });
        },
        hitTest: (pt, ent) => Math.abs(dist(pt, ent.p1) - 25) < 8 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    dimension: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const dx = ent.p2.x - ent.p1.x;
            const dy = ent.p2.y - ent.p1.y;
            const len = Math.hypot(dx, dy);
            if (len === 0) { ctx.restore(); return; }

            const nx = -dy / len;
            const ny = dx / len;
            
            let offset = 40;
            if (ent.p3) {
                offset = (ent.p3.x - ent.p1.x) * nx + (ent.p3.y - ent.p1.y) * ny;
            }

            const dp1 = { x: ent.p1.x + offset * nx, y: ent.p1.y + offset * ny };
            const dp2 = { x: ent.p2.x + offset * nx, y: ent.p2.y + offset * ny };

            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.fillStyle = ctx.strokeStyle;
            ctx.lineWidth = isSelected ? styleSettings[ent.type].weight + 1 : styleSettings[ent.type].weight;

            if (isPreview && state.drawingStep === 1) {
                ctx.setLineDash([4, 4]);
            }

            // Extension lines (extending slightly past the dimension line)
            if (ent.dimLines !== false) {
                const extOvershoot = 6;
                const extOffset = offset + (offset >= 0 ? extOvershoot : -extOvershoot);
                const gap = 4;
                const dirX = offset >= 0 ? 1 : -1;
                
                ctx.beginPath();
                ctx.moveTo(ent.p1.x + nx * gap * dirX, ent.p1.y + ny * gap * dirX);
                ctx.lineTo(ent.p1.x + nx * extOffset, ent.p1.y + ny * extOffset);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(ent.p2.x + nx * gap * dirX, ent.p2.y + ny * gap * dirX);
                ctx.lineTo(ent.p2.x + nx * extOffset, ent.p2.y + ny * extOffset);
                ctx.stroke();
            }

            // Text measurement
            const lengthVal = len / state.gridSize;
            let textStr = "";
            if (ent.dimText && ent.dimText.trim() !== '') {
                textStr = ent.dimText;
            } else {
                const dec = ent.dimDecimals !== undefined ? ent.dimDecimals : 3;
                textStr = lengthVal.toFixed(dec);
                if (ent.dimUnits !== false) {
                    textStr += 'm';
                }
            }

            ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
            const textWidth = ctx.measureText(textStr).width + 12;
            
            const midX = (dp1.x + dp2.x) / 2;
            const midY = (dp1.y + dp2.y) / 2;
            const angle = Math.atan2(dy, dx);
            const rotAngle = Math.abs(angle) > Math.PI/2 ? angle + Math.PI : angle;
            
            ctx.save();
            ctx.translate(midX, midY);
            ctx.rotate(rotAngle);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const th = 16;
            ctx.fillStyle = document.getElementById('canvas-wrapper').style.backgroundColor || '#f8fafc';
            ctx.fillRect(-textWidth/2, -th/2, textWidth, th);
            
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fillText(textStr, 0, 0);
            ctx.restore();

            // Draw line with arrows
            const headlen = 12;
            const hAngle = Math.PI / 8;

            // Arrow at dp1
            ctx.beginPath();
            ctx.moveTo(dp1.x, dp1.y);
            ctx.lineTo(midX - (dx/len)*(textWidth/2), midY - (dy/len)*(textWidth/2));
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(dp1.x, dp1.y);
            ctx.lineTo(dp1.x + headlen * Math.cos(angle - hAngle), dp1.y + headlen * Math.sin(angle - hAngle));
            ctx.moveTo(dp1.x, dp1.y);
            ctx.lineTo(dp1.x + headlen * Math.cos(angle + hAngle), dp1.y + headlen * Math.sin(angle + hAngle));
            ctx.stroke();

            // Arrow at dp2
            ctx.beginPath();
            ctx.moveTo(dp2.x, dp2.y);
            ctx.lineTo(midX + (dx/len)*(textWidth/2), midY + (dy/len)*(textWidth/2));
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(dp2.x, dp2.y);
            ctx.lineTo(dp2.x + headlen * Math.cos(angle - Math.PI - hAngle), dp2.y + headlen * Math.sin(angle - Math.PI - hAngle));
            ctx.moveTo(dp2.x, dp2.y);
            ctx.lineTo(dp2.x + headlen * Math.cos(angle - Math.PI + hAngle), dp2.y + headlen * Math.sin(angle - Math.PI + hAngle));
            ctx.stroke();

            ctx.restore();
        },
        hitTest: (pt, ent) => {
            const dx = ent.p2.x - ent.p1.x;
            const dy = ent.p2.y - ent.p1.y;
            const len = Math.hypot(dx, dy);
            if (len === 0) return false;
            const nx = -dy / len;
            const ny = dx / len;
            let offset = ent.p3 ? ((ent.p3.x - ent.p1.x) * nx + (ent.p3.y - ent.p1.y) * ny) : 40;
            const dp1 = { x: ent.p1.x + offset * nx, y: ent.p1.y + offset * ny };
            const dp2 = { x: ent.p2.x + offset * nx, y: ent.p2.y + offset * ny };
            return distToLine(pt, dp1, dp2) < 10 / state.vw.z;
        },
        move: (ent, dx, dy) => { 
            ent.p1.x += dx; ent.p1.y += dy; 
            ent.p2.x += dx; ent.p2.y += dy; 
            if(ent.p3) { ent.p3.x += dx; ent.p3.y += dy; }
        }
    },
    angdim: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const dx1 = ent.p2.x - ent.p1.x;
            const dy1 = ent.p2.y - ent.p1.y;
            
            // If only p1 and p2 are defined, we just draw a line (step 1 preview)
            if (!ent.p3) {
                ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(ent.p1.x, ent.p1.y);
                ctx.lineTo(ent.p2.x, ent.p2.y);
                ctx.stroke();
                ctx.restore();
                return;
            }

            const dx2 = ent.p3.x - ent.p1.x;
            const dy2 = ent.p3.y - ent.p1.y;
            
            let a1 = Math.atan2(dy1, dx1);
            let a2 = Math.atan2(dy2, dx2);
            
            let angleDiff = a2 - a1;
            
            // Normalize angle diff to [0, 2PI)
            while (angleDiff < 0) angleDiff += Math.PI * 2;
            while (angleDiff >= Math.PI * 2) angleDiff -= Math.PI * 2;
            
            const radius = ent.magnitude ? parseFloat(ent.magnitude) : 40; // use magnitude to store radius tracking

            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.fillStyle = ctx.strokeStyle;
            ctx.lineWidth = isSelected ? styleSettings[ent.type].weight + 1 : styleSettings[ent.type].weight;

            if (isPreview && state.drawingStep === 2) {
                ctx.setLineDash([4, 4]);
                // draw preview line 2
                ctx.beginPath();
                ctx.moveTo(ent.p1.x, ent.p1.y);
                ctx.lineTo(ent.p3.x, ent.p3.y);
                ctx.stroke();
            } else {
                // draw lines when done
                if (ent.dimLines !== false) {
                    ctx.beginPath();
                    ctx.moveTo(ent.p1.x, ent.p1.y);
                    ctx.lineTo(ent.p1.x + Math.cos(a1)*(radius+10), ent.p1.y + Math.sin(a1)*(radius+10));
                    ctx.moveTo(ent.p1.x, ent.p1.y);
                    ctx.lineTo(ent.p1.x + Math.cos(a2)*(radius+10), ent.p1.y + Math.sin(a2)*(radius+10));
                    ctx.stroke();
                }
            }
            
            ctx.setLineDash([]);
            
            // Handle sweep direction
            let startA = a1;
            let endA = a2;
            
            // Ensure we draw the smaller angle by default
            if (angleDiff > Math.PI) {
                 startA = a2;
                 endA = a1;
                 angleDiff = Math.PI * 2 - angleDiff;
                 while(endA < startA) endA += Math.PI * 2;
            }

            // Draw arc
            ctx.beginPath();
            ctx.arc(ent.p1.x, ent.p1.y, radius, startA, endA, false);
            ctx.stroke();
            
            // Arrows
            const headlen = 10;
            const hAngle = Math.PI / 8;
            
            const t1Start = startA + Math.PI/2;
            ctx.beginPath();
            const px1 = ent.p1.x + radius*Math.cos(startA);
            const py1 = ent.p1.y + radius*Math.sin(startA);
            ctx.moveTo(px1, py1);
            ctx.lineTo(px1 + headlen * Math.cos(t1Start - hAngle), py1 + headlen * Math.sin(t1Start - hAngle));
            ctx.moveTo(px1, py1);
            ctx.lineTo(px1 + headlen * Math.cos(t1Start + hAngle), py1 + headlen * Math.sin(t1Start + hAngle));
            ctx.stroke();

            const t2End = endA - Math.PI/2;
            ctx.beginPath();
            const px2 = ent.p1.x + radius*Math.cos(endA);
            const py2 = ent.p1.y + radius*Math.sin(endA);
            ctx.moveTo(px2, py2);
            ctx.lineTo(px2 + headlen * Math.cos(t2End - hAngle), py2 + headlen * Math.sin(t2End - hAngle));
            ctx.moveTo(px2, py2);
            ctx.lineTo(px2 + headlen * Math.cos(t2End + hAngle), py2 + headlen * Math.sin(t2End + hAngle));
            ctx.stroke();

            // Text
            const angleDeg = (angleDiff * 180 / Math.PI);
            let textStr = "";
            if (ent.dimText && ent.dimText.trim() !== '') {
                textStr = ent.dimText;
            } else {
                const dec = ent.dimDecimals !== undefined ? ent.dimDecimals : 1;
                textStr = angleDeg.toFixed(dec) + "°";
            }
            
            ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
            const textWidth = ctx.measureText(textStr).width + 8;
            const th = 16;
            
            const midA = startA + (endA - startA) / 2;
            const tmX = ent.p1.x + (radius + 20) * Math.cos(midA);
            const tmY = ent.p1.y + (radius + 20) * Math.sin(midA);
            
            ctx.save();
            ctx.translate(tmX, tmY);
            
            let rotA = midA + Math.PI/2;
            if (rotA > Math.PI/2 && rotA < Math.PI*3/2) rotA -= Math.PI;
            ctx.rotate(rotA);
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            ctx.fillStyle = document.getElementById('canvas-wrapper').style.backgroundColor || '#f8fafc';
            ctx.fillRect(-textWidth/2, -th/2, textWidth, th);
            
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fillText(textStr, 0, 0);
            
            ctx.restore();

            ctx.restore();
        },
        hitTest: (pt, ent) => {
            if(!ent.p3) return false;
            const radius = ent.magnitude ? parseFloat(ent.magnitude) : 40;
            return Math.abs(dist(pt, ent.p1) - radius) < 10 / state.vw.z;
        },
        move: (ent, dx, dy) => { 
            ent.p1.x += dx; ent.p1.y += dy; 
            ent.p2.x += dx; ent.p2.y += dy; 
            if(ent.p3) { ent.p3.x += dx; ent.p3.y += dy; }
        }
    },
    pin: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.fillStyle = ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;
            const t = 12;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-t, t*1.5); ctx.lineTo(t, t*1.5); ctx.closePath(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-t*1.5, t*1.5); ctx.lineTo(t*1.5, t*1.5); ctx.stroke();
            drawHatching(ctx, 0, t*1.5, t*3);
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 15 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    roller: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.fillStyle = ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;
            const r = 8;
            ctx.beginPath(); ctx.arc(0, r, r, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-r*2, r*2); ctx.lineTo(r*2, r*2); ctx.stroke();
            drawHatching(ctx, 0, r*2, r*4);
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 20 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    fixed: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.fillStyle = ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight + 1;
            const h = 18;
            ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(0, h); ctx.stroke();
            ctx.lineWidth = 1;
            for(let i = -h; i <= h; i += 6) {
                ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(-6, i + 6); ctx.stroke();
            }
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 18 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    hinge: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight + 0.5;
            ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); 
            ctx.fill(); ctx.stroke();
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 12 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    spring: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;
            
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, 6);
            ctx.lineTo(-6, 10);
            ctx.lineTo(6, 18);
            ctx.lineTo(-6, 26);
            ctx.lineTo(0, 30);
            ctx.lineTo(0, 36);
            ctx.stroke();
            
            ctx.beginPath(); ctx.moveTo(-15, 36); ctx.lineTo(15, 36); ctx.stroke();
            drawHatching(ctx, 0, 36, 30);
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 25 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    rotspr: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            applyEntityTransform(ctx, ent);
            ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;
            
            ctx.beginPath();
            let loops = 2.5;
            for(let i=0; i<loops*Math.PI*2; i+=0.1) {
                let r = 3 + i * 1.8;
                ctx.lineTo(r*Math.cos(i), r*Math.sin(i));
            }
            ctx.stroke();

            // Connect to Ground
            ctx.beginPath(); ctx.moveTo(0, 25); ctx.lineTo(0, 35); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-15, 35); ctx.lineTo(15, 35); ctx.stroke();
            drawHatching(ctx, 0, 35, 30);
            
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 30 / state.vw.z,
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    textLabel: {
        draw: (ctx, ent, isSelected) => {
            const txt = ent.textContent || 'Text';
            const size = ent.textSize || styleSettings.textLabel.text;
            const font = ent.textFont || 'sans-serif';
            const col = ent.textColor || styleSettings.textLabel.rgba;
            const isBold = ent.textBold ? 'bold ' : '';
            
            ctx.save();
            ctx.translate(ent.p1.x, ent.p1.y);
            if (ent.angle) ctx.rotate(ent.angle);
            
            ctx.font = `${isBold}${size}px ${font}`;
            ctx.fillStyle = isSelected ? '#3b82f6' : col;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            
            // Re-flip text if viewing top-down (to prevent upside-down text) but canvas implies positive Y goes down naturally... wait, Y down is default canvas.
            ctx.fillText(txt, 0, 0);
            
            if (isSelected) {
                const metrics = ctx.measureText(txt);
                const w = metrics.width;
                const h = size;
                ctx.strokeStyle = '#3b82f6';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1 / state.vw.z;
                ctx.strokeRect(-2, -2, w+4, h+4);
            }
            ctx.restore();
        },
        hitTest: (pt, ent) => {
            const size = ent.textSize || styleSettings.textLabel.text;
            const txt = ent.textContent || 'Text';
            const w = txt.length * size * 0.6; // Approximation
            const h = size;
            
            const dx = pt.x - ent.p1.x;
            const dy = pt.y - ent.p1.y;
            const angle = ent.angle || 0;
            const rx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
            const ry = dx * Math.sin(-angle) + dy * Math.cos(-angle);
            
            return rx >= -5 && rx <= w + 5 && ry >= -5 && ry <= h + 5;
        },
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    }
};

// Rendering Loop
let renderQueued = false;
function requestRedraw() {
    if (!renderQueued) {
        renderQueued = true;
        requestAnimationFrame(render);
    }
}

function updateGridBackground() {
    wrapper.style.backgroundColor = styleSettings.bgColor;
    if (styleSettings.showGrid) {
        wrapper.style.backgroundImage = 'linear-gradient(to right, rgba(203, 213, 225, 0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(203, 213, 225, 0.4) 1px, transparent 1px)';
        const bgSize = state.gridSize * state.vw.z;
        wrapper.style.backgroundSize = `${bgSize}px ${bgSize}px`;
        wrapper.style.backgroundPosition = `${state.vw.x}px ${state.vw.y}px`;
    } else {
        wrapper.style.backgroundImage = 'none';
    }
}

function drawGridDimensions(ctx, cWidth, cHeight) {
    ctx.save();
    ctx.fillStyle = '#94a3b8'; // slate-400 text color
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Calculate display step to prevent clutter (skip lines if zoom is small)
    let skip = 1; 
    while (skip * state.gridSize * state.vw.z < 50) skip *= 2; 

    // Draw X axis dimensions (top edge)
    let startX = Math.floor(s2w({x: 0, y: 0}).x / (state.gridSize * skip)) * skip;
    let endX = Math.ceil(s2w({x: cWidth, y: 0}).x / (state.gridSize * skip)) * skip;
    
    for (let i = startX; i <= endX; i += skip) {
        const screenX = w2s({x: i * state.gridSize, y: 0}).x;
        ctx.fillText(i + 'm', screenX, 4);
        ctx.fillRect(screenX, 0, 1, 4); // tiny tick mark
    }

    // Draw Y axis dimensions (left edge)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let startY = Math.floor(s2w({x: 0, y: 0}).y / (state.gridSize * skip)) * skip;
    let endY = Math.ceil(s2w({x: 0, y: cHeight}).y / (state.gridSize * skip)) * skip;
    
    for (let i = startY; i <= endY; i += skip) {
        if (i === 0) continue; // skip 0 so it doesn't overlap X-axis 0
        const screenY = w2s({x: 0, y: i * state.gridSize}).y;
        ctx.fillText(i + 'm', 6, screenY);
        ctx.fillRect(0, screenY, 4, 1); // tiny tick mark
    }
    
    ctx.restore();
}

function isEntityVisible(ent) {
    if (!ent) return true;
    const type = ent.type;
    if (['beam', 'arc', 'parabola'].includes(type)) {
        return document.getElementById('vis-structure')?.checked ?? true;
    }
    if (['pin', 'roller', 'fixed', 'hinge', 'spring', 'rotspr'].includes(type)) {
        return document.getElementById('vis-supports')?.checked ?? true;
    }
    if (['force', 'distload', 'moment'].includes(type)) {
        return document.getElementById('vis-loads')?.checked ?? true;
    }
    return true; // dimension, text, etc
}

function render() {
    const cWidth = wrapper.clientWidth;
    const cHeight = wrapper.clientHeight;
    ctx.clearRect(0, 0, cWidth, cHeight);
    updateGridBackground();

    ctx.save();
    ctx.translate(state.vw.x, state.vw.y);
    ctx.scale(state.vw.z, state.vw.z);

    // Draw global Origin X/Y Axes lightly
    ctx.beginPath();
    ctx.moveTo(-100000, 0); ctx.lineTo(100000, 0);
    ctx.moveTo(0, -100000); ctx.lineTo(0, 100000);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)'; // Slate-400 with opacity
    ctx.lineWidth = 1 / state.vw.z;
    ctx.stroke();

    ctx.globalAlpha = styleSettings.opacity;

    for (const ent of state.entities) {
        if (!isEntityVisible(ent)) continue;
        EntityLogic[ent.type].draw(ctx, ent, state.selectedIds.includes(ent.id), false);
    }

    if (state.tempEntity) {
        // Draw temporary entity in preview mode
        EntityLogic[state.tempEntity.type].draw(ctx, state.tempEntity, false, true);
    }
    
    // Draw grips for selected entities
    if (state.selectedIds.length > 0) {
        state.selectedIds.forEach(id => {
            const selEnt = state.entities.find(e => e.id === id);
            if (selEnt && selEnt.p1 && selEnt.p2) {
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 1.5 / state.vw.z;
                const r = 4 / state.vw.z;
                
                const drawGrip = (p) => {
                    ctx.beginPath();
                    ctx.rect(p.x - r, p.y - r, r*2, r*2);
                    ctx.fill();
                    ctx.stroke();
                };
                
                drawGrip(selEnt.p1);
                drawGrip(selEnt.p2);
                if (selEnt.p3) drawGrip(selEnt.p3);
            }
        });
    }

    // Draw FE Diagram overlays
    if (state.feResults && state.feResults.success && state.activeDiagram && typeof drawFEDiagrams === 'function') {
        drawFEDiagrams(ctx, state.feResults, state.activeDiagram, state.diagramScale, state.mouseWorldPos);
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();

    // Draw Ortho Tracking Line Guide
    if (snapMode.trackRef && snapMode.trackAxis && ['force', 'moment', 'distload', 'pin', 'roller', 'fixed', 'hinge', 'spring', 'rotspr', 'beam', 'arc', 'parabola', 'dimension'].includes(state.tool) && !state.isMovingEntity) {
        ctx.save();
        ctx.setTransform(state.vw.z, 0, 0, state.vw.z, state.vw.x, state.vw.y);
        
        ctx.beginPath();
        ctx.moveTo(snapMode.trackRef.x, snapMode.trackRef.y);
        ctx.lineTo(state.cursorPt.x, state.cursorPt.y);
        ctx.strokeStyle = '#94a3b8'; // subtle slate color
        ctx.lineWidth = 1.5 / state.vw.z;
        ctx.setLineDash([5 / state.vw.z, 5 / state.vw.z]);
        ctx.stroke();

        // draw a small target cross at trackRef
        ctx.beginPath();
        const cr = 4 / state.vw.z;
        ctx.moveTo(snapMode.trackRef.x - cr, snapMode.trackRef.y);
        ctx.lineTo(snapMode.trackRef.x + cr, snapMode.trackRef.y);
        ctx.moveTo(snapMode.trackRef.x, snapMode.trackRef.y - cr);
        ctx.lineTo(snapMode.trackRef.x, snapMode.trackRef.y + cr);
        ctx.setLineDash([]);
        ctx.stroke();
        
        ctx.restore();
    }

    // Draw ruler dimensions around GUI
    if (styleSettings.showGrid) {
        drawGridDimensions(ctx, cWidth, cHeight);
    }
    
    // Draw export selection box
    if (state.tool === 'export-area' && state.exportBox) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        
        // Fill everything except the box
        ctx.beginPath();
        ctx.rect(0, 0, cWidth, cHeight);
        ctx.rect(state.exportBox.x, state.exportBox.y, state.exportBox.w, state.exportBox.h);
        ctx.fill("evenodd");

        // Border around the box
        ctx.strokeStyle = '#ffffff';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(state.exportBox.x, state.exportBox.y, state.exportBox.w, state.exportBox.h);
        
        ctx.restore();
    }

    // Draw selection box
    if (state.isBoxSelecting && state.selectionBox) {
        ctx.save();
        ctx.fillStyle = 'rgba(74, 144, 226, 0.2)';
        ctx.strokeStyle = 'rgba(74, 144, 226, 0.8)';
        ctx.lineWidth = 1;
        const x = Math.min(state.selectionBox.startX, state.selectionBox.endX);
        const y = Math.min(state.selectionBox.startY, state.selectionBox.endY);
        const w = Math.abs(state.selectionBox.endX - state.selectionBox.startX);
        const h = Math.abs(state.selectionBox.endY - state.selectionBox.startY);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }
    
    renderQueued = false;
}

// Canvas Interactions
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const wPt = s2w({ x: screenX, y: screenY });
    
    if (state.tool === 'export-area') {
        state.exportBox = { x: screenX, y: screenY, w: 0, h: 0 };
        return;
    }

    // Middle click OR Shift + Left Click for Panning
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        state.isDraggingVp = true;
        state.startX = screenX;
        state.startY = screenY;
        return;
    }
    if (e.button !== 0) return;

    if (state.tool === 'select') {
        const handleRadius = 6 / state.vw.z;
        let gripClicked = null;
        
        // Check grips of currently selected entity first (only if exactly 1 is selected)
        if (state.selectedEntityId && state.selectedIds.length <= 1) {
            const selEnt = state.entities.find(en => en.id === state.selectedEntityId);
            if (selEnt && selEnt.p1 && selEnt.p2) {
                if (dist(wPt, selEnt.p1) < handleRadius) gripClicked = 'p1';
                else if (dist(wPt, selEnt.p2) < handleRadius) gripClicked = 'p2';
                else if (selEnt.p3 && dist(wPt, selEnt.p3) < handleRadius) gripClicked = 'p3';
            }
        }
        
        if (gripClicked) {
            state.isDraggingGrip = gripClicked;
            saveState();
            return;
        }

        let clicked = null;
        for (let i = state.entities.length - 1; i >= 0; i--) {
            if (EntityLogic[state.entities[i].type].hitTest(wPt, state.entities[i])) {
                clicked = state.entities[i];
                break;
            }
        }
        
        if (clicked) {
            if (e.ctrlKey) {
                if (state.selectedIds.includes(clicked.id)) {
                    state.selectedIds = state.selectedIds.filter(id => id !== clicked.id);
                } else {
                    state.selectedIds.push(clicked.id);
                }
            } else {
                if (!state.selectedIds.includes(clicked.id)) {
                    state.selectedIds = [clicked.id];
                }
            }
            state.selectedEntityId = state.selectedIds.length > 0 ? state.selectedIds[state.selectedIds.length - 1] : null;
            
            state.isMovingEntity = true;
            // Temporarily ignore the moving entity in snap to avoid self-snapping loops while dragging
            let sPt = snap(wPt);
            state.startX = sPt.x;
            state.startY = sPt.y;
            saveState();
        } else {
            if (!e.ctrlKey) {
                state.selectedEntityId = null;
                state.selectedIds = [];
            }
            state.isBoxSelecting = true;
            state.selectionBox = { startX: screenX, startY: screenY, endX: screenX, endY: screenY };
        }
        updatePropertyPanel();
        requestRedraw();
        return;
    }

    if (state.tool === 'influence') {
        let clicked = null;
        for (let i = state.entities.length - 1; i >= 0; i--) {
            if (EntityLogic[state.entities[i].type].hitTest(wPt, state.entities[i])) {
                clicked = state.entities[i];
                break;
            }
        }
        if (clicked) {
            const supportTypes = ['pin', 'roller', 'fixed', 'hinge', 'spring', 'rotspr'];
            if (supportTypes.includes(clicked.type)) {
                const component = prompt("Influence Line target: Support.\nWhich force component to track? (Type: Rx, Ry, or Mz)", "Ry");
                if (component) runInfluenceLine(clicked, 'reaction', component.toLowerCase(), null);
            } else if (clicked.type === 'beam') {
                const dx = clicked.p2.x - clicked.p1.x;
                const dy = clicked.p2.y - clicked.p1.y;
                const L = Math.hypot(dx, dy);
                const dxp = wPt.x - clicked.p1.x;
                const dyp = wPt.y - clicked.p1.y;
                let ratio = (dxp * dx + dyp * dy) / (L * L);
                if (ratio < 0) ratio = 0;
                if (ratio > 1) ratio = 1;
                
                const ratioDisplay = (ratio * 100).toFixed(1) + "%";
                const component = prompt(`Influence Line target: Beam (at ${ratioDisplay} length).\nWhich internal force to track? (Type: V or M)`, "M");
                if (component) runInfluenceLine(clicked, 'internal', component.toLowerCase(), ratio);
            } else {
                alert("Please click on a Support or a Beam to target an influence line.");
            }
        }
        return;
    }

    // Multi-click tools
    if (['beam', 'arc', 'parabola', 'distload', 'dimension', 'angdim', 'line', 'arrow'].includes(state.tool)) {
        if (state.drawingStep === 0) {
            saveState();
            state.drawingStep = 1;
            state.tempEntity = {
                id: generateId(),
                type: state.tool,
                p1: snap(wPt),
                p2: snap(wPt),
                p3: snap(wPt),
                angle: 0,
                magnitude: ['distload'].includes(state.tool) ? '10' : undefined
            };
            if (state.tool === 'beam') state.tempEntity.isTruss = false;
            
            // Automatically make the start point a tracking reference
            snapMode.trackRef = { ...state.tempEntity.p1 };
            snapMode.trackAxis = null;
            
            if (state.tool === 'beam') {
                const lp = document.getElementById('cad-input-panel');
                const inp = document.getElementById('cad-input');
                document.getElementById('cad-input-label').innerText = 'Length';
                lp.classList.remove('hidden');
                inp.value = '';
                // Prevents the canvas click event from immediately stealing focus back
                setTimeout(() => inp.focus(), 10);
            }
        } else if (state.drawingStep === 1) {
            if (dist(state.tempEntity.p1, state.tempEntity.p2) > 0) {
                if (['dimension', 'arc', 'parabola', 'angdim'].includes(state.tool)) {
                    state.drawingStep = 2;
                    state.tempEntity.p3 = wPt;
                    
                    if (state.tool === 'arc') {
                        const lp = document.getElementById('cad-input-panel');
                        const inp = document.getElementById('cad-input');
                        document.getElementById('cad-input-label').innerText = 'Radius';
                        lp.classList.remove('hidden');
                        inp.value = '';
                        setTimeout(() => inp.focus(), 10);
                    }
                } else {
                    state.entities.push({...state.tempEntity});
                    state.selectedIds = [state.tempEntity.id];
                    state.selectedEntityId = state.tempEntity.id;
                    state.tempEntity = null;
                    state.drawingStep = 0;
                    document.getElementById('cad-input-panel').classList.add('hidden');
                    document.querySelector(`.tool-btn[data-tool="select"]`).click();
                    updatePropertyPanel();
                }
            } else {
                history.undo.pop();
                state.tempEntity = null;
                state.drawingStep = 0;
                document.getElementById('cad-input-panel').classList.add('hidden');
                document.querySelector(`.tool-btn[data-tool="select"]`).click();
            }
        } else if (state.drawingStep === 2 && ['dimension', 'arc', 'parabola', 'angdim'].includes(state.tool)) {
            if (state.tool === 'dimension') {
                let snappedPt = null;
                let minDistDim = Infinity;
                
                // Prioritize aligning with an existing dimension line
                for (const ent of state.entities) {
                    if (ent.type === 'dimension' && ent.id !== state.tempEntity.id) {
                        const dx = ent.p2.x - ent.p1.x;
                        const dy = ent.p2.y - ent.p1.y;
                        const len = Math.hypot(dx, dy);
                        if (len === 0) continue;
                        const nx = -dy / len;
                        const ny = dx / len;
                        let offset = 40;
                        if (ent.p3) offset = (ent.p3.x - ent.p1.x) * nx + (ent.p3.y - ent.p1.y) * ny;
                        const dp1 = { x: ent.p1.x + offset * nx, y: ent.p1.y + offset * ny };
                        const dp2 = { x: ent.p2.x + offset * nx, y: ent.p2.y + offset * ny };
                        
                        const l2 = (dp2.x - dp1.x)**2 + (dp2.y - dp1.y)**2;
                        if (l2 === 0) continue;
                        const t = ((wPt.x - dp1.x) * (dp2.x - dp1.x) + (wPt.y - dp1.y) * (dp2.y - dp1.y)) / l2;
                        const projPt = { x: dp1.x + t * (dp2.x - dp1.x), y: dp1.y + t * (dp2.y - dp1.y) };
                        const d = Math.hypot(wPt.x - projPt.x, wPt.y - projPt.y);
                        
                        if (d < 15 / state.vw.z && d < minDistDim) {
                            minDistDim = d;
                            snappedPt = projPt;
                        }
                    }
                }
                
                // Fall back to standard grid/node snapping if no alignment dimension is nearby
                if (!snappedPt) {
                    snappedPt = snap(wPt);
                }
                
                state.tempEntity.p3 = snappedPt;
            } else {
                state.tempEntity.p3 = state.tool === 'angdim' ? snap(wPt) : wPt;
            }
            state.entities.push({...state.tempEntity});
            state.selectedIds = [state.tempEntity.id];
            state.selectedEntityId = state.tempEntity.id;
            state.tempEntity = null;
            state.drawingStep = 0;
            document.getElementById('cad-input-panel').classList.add('hidden');
            document.querySelector(`.tool-btn[data-tool="select"]`).click();
            updatePropertyPanel();
        }
        requestRedraw();
        return;
    }

    // Single-click tools (Supports, Moments, Text, Force)
    if (['pin', 'roller', 'fixed', 'hinge', 'spring', 'rotspr', 'moment', 'textLabel', 'force'].includes(state.tool)) {
        saveState();
        const pt = snap(wPt);
        const newEnt = {
            id: generateId(),
            type: state.tool,
            p1: pt,
            angle: state.tool === 'force' ? Math.PI / 2 : 0,
            magnitude: ['moment', 'force'].includes(state.tool) ? '10' : undefined
        };
        
        if (state.tool === 'force') {
            const visualLen = 40 / state.vw.z;
            newEnt.p2 = { x: pt.x, y: pt.y }; // Arrow head at click location
            newEnt.p1 = { x: pt.x, y: pt.y - visualLen }; // Tail above it
        }

        state.entities.push(newEnt);
        state.selectedIds = [newEnt.id];
        state.selectedEntityId = newEnt.id;
        
        document.querySelector(`.tool-btn[data-tool="select"]`).click();
        updatePropertyPanel();
        requestRedraw();
    }
});

window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // Save world coordinates for data inspection
    const cursorWorldPt = s2w({ x: screenX, y: screenY });
    state.mouseWorldPos = cursorWorldPt;

    if (state.tool === 'export-area' && state.exportBox) {
        state.exportBox.w = screenX - state.exportBox.x;
        state.exportBox.h = screenY - state.exportBox.y;
        requestRedraw();
        return;
    }

    if (state.isBoxSelecting && state.selectionBox) {
        state.selectionBox.endX = screenX;
        state.selectionBox.endY = screenY;
        requestRedraw();
        return;
    }

    if (state.isDraggingVp) {
        state.vw.x += (screenX - state.startX);
        state.vw.y += (screenY - state.startY);
        state.startX = screenX;
        state.startY = screenY;
        requestRedraw();
        return;
    }

    const wPt = s2w({ x: screenX, y: screenY });
    state.cursorPt = snap(wPt);

    if (state.isDraggingGrip && state.selectedEntityId) {
        const ent = state.entities.find(e => e.id === state.selectedEntityId);
        if (ent) {
            const oldEntities = state.entities;
            state.entities = state.entities.filter(e => e.id !== state.selectedEntityId);
            
            state.cursorPt = snap(wPt);
            
            state.entities = oldEntities; // restore
            
            ent[state.isDraggingGrip].x = state.cursorPt.x;
            ent[state.isDraggingGrip].y = state.cursorPt.y;
            
            // In case of force, update angle visually as well if p1/p2 moves
            if (ent.type === 'force') {
               ent.angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
            }
            
            updatePropertyPanel();
            requestRedraw();
        }
        return;
    }

    if (state.isMovingEntity && state.selectedIds.length > 0) {
        // Exclude all currently moving entities from snap consideration temporarily
        const movingEnts = state.entities.filter(e => state.selectedIds.includes(e.id));
        if (movingEnts.length > 0) {
            // we override snap bypass for self
            const oldEntities = state.entities;
            state.entities = state.entities.filter(e => !state.selectedIds.includes(e.id));
            
            state.cursorPt = snap(wPt);
            
            state.entities = oldEntities; // restore

            const dx = state.cursorPt.x - state.startX;
            const dy = state.cursorPt.y - state.startY;
            if (dx !== 0 || dy !== 0) {
                movingEnts.forEach(ent => {
                    EntityLogic[ent.type].move(ent, dx, dy);
                });
                state.startX = state.cursorPt.x;
                state.startY = state.cursorPt.y;
            }
            requestRedraw();
        }
        return;
    }

    // Update drawing tool preview
    if (state.drawingStep === 1 && state.tempEntity) {
        state.tempEntity.p2 = snap(wPt);
        if (['dimension', 'arc', 'parabola', 'angdim'].includes(state.tempEntity.type)) {
            state.tempEntity.p3 = snap(wPt);
        }
        
        if (state.tempEntity.type === 'beam') {
            const inp = document.getElementById('cad-input');
            const lUnits = dist(state.tempEntity.p1, state.tempEntity.p2) / state.gridSize;
            if (document.activeElement !== inp || inp.value === '') {
                inp.placeholder = lUnits.toFixed(1);
            }
        }
        requestRedraw();
    } else if (state.drawingStep === 2 && state.tempEntity && ['dimension', 'arc', 'parabola', 'angdim'].includes(state.tempEntity.type)) {
        if (state.tempEntity.type === 'dimension') {
            let snappedPt = null;
            let minDistDim = Infinity;
            
            for (const ent of state.entities) {
                if (ent.type === 'dimension' && ent.id !== state.tempEntity.id) {
                    const dx = ent.p2.x - ent.p1.x;
                    const dy = ent.p2.y - ent.p1.y;
                    const len = Math.hypot(dx, dy);
                    if (len === 0) continue;
                    const nx = -dy / len;
                    const ny = dx / len;
                    let offset = 40;
                    if (ent.p3) {
                        offset = (ent.p3.x - ent.p1.x) * nx + (ent.p3.y - ent.p1.y) * ny;
                    }
                    const dp1 = { x: ent.p1.x + offset * nx, y: ent.p1.y + offset * ny };
                    const dp2 = { x: ent.p2.x + offset * nx, y: ent.p2.y + offset * ny };
                    
                    const l2 = (dp2.x - dp1.x)**2 + (dp2.y - dp1.y)**2;
                    if (l2 === 0) continue;
                    const t = ((wPt.x - dp1.x) * (dp2.x - dp1.x) + (wPt.y - dp1.y) * (dp2.y - dp1.y)) / l2;
                    const projPt = { x: dp1.x + t * (dp2.x - dp1.x), y: dp1.y + t * (dp2.y - dp1.y) };
                    const d = Math.hypot(wPt.x - projPt.x, wPt.y - projPt.y);
                    
                    if (d < 15 / state.vw.z && d < minDistDim) {
                        minDistDim = d;
                        snappedPt = projPt;
                    }
                }
            }
            
            if (!snappedPt) {
                snappedPt = snap(wPt);
            }
            state.tempEntity.p3 = snappedPt;
        } else {
            state.tempEntity.p3 = state.tempEntity.type === 'angdim' ? snap(wPt) : wPt; // Snap p3 for angdim, free drag otherwise
        }
        
        // For angdim, we also track radius using magnitude parameter loosely
        if (state.tempEntity.type === 'angdim') {
            state.tempEntity.magnitude = dist(state.tempEntity.p1, state.tempEntity.p3); 
        }

        if (state.tempEntity.type === 'arc') {
            const pt1 = state.tempEntity.p1;
            const pt2 = state.tempEntity.p2;
            const dx = pt2.x - pt1.x;
            const dy = pt2.y - pt1.y;
            const L = Math.hypot(dx, dy);
            
            const nx = -dy / L;
            const ny = dx / L;
            const mx = (pt1.x + pt2.x) / 2;
            const my = (pt1.y + pt2.y) / 2;
            const h = (state.tempEntity.p3.x - mx) * nx + (state.tempEntity.p3.y - my) * ny;
            
            if (Math.abs(h) > 1e-3) {
                const R = Math.abs((L * L) / (8 * h) + h / 2) / state.gridSize;
                const inp = document.getElementById('cad-input');
                if (document.activeElement !== inp || inp.value === '') {
                    inp.placeholder = R.toFixed(2);
                }
            }
        }
        requestRedraw();
    } else {
        // Redraw to show smart tracking guides even when not actively drawing a shape
        requestRedraw();
    }
});

window.addEventListener('mouseup', (e) => {
    if (state.tool === 'export-area' && state.exportBox) {
        // Enforce a minimum size
        if (Math.abs(state.exportBox.w) > 10 && Math.abs(state.exportBox.h) > 10) {
            doExport(state.exportBox);
        }
        state.exportBox = null;
        document.querySelector('.tool-btn[data-tool="select"]').click();
        return;
    }
    
    if (state.isBoxSelecting && state.selectionBox) {
        const box = state.selectionBox;
        // Normalize box
        const x1 = Math.min(box.startX, box.endX);
        const y1 = Math.min(box.startY, box.endY);
        const x2 = Math.max(box.startX, box.endX);
        const y2 = Math.max(box.startY, box.endY);
        
        const pt1 = s2w({x: x1, y: y1});
        const pt2 = s2w({x: x2, y: y2});

        const left = Math.min(pt1.x, pt2.x);
        const right = Math.max(pt1.x, pt2.x);
        const top = Math.min(pt1.y, pt2.y);
        const bottom = Math.max(pt1.y, pt2.y);
        
        let selectedNew = [];
        state.entities.forEach(ent => {
            if (ent.p1) {
                // simple bounding box check
                let pts = [ent.p1];
                if (ent.p2) pts.push(ent.p2);
                if (ent.p3) pts.push(ent.p3);
                
                // check if ALL points are inside the box
                let allIn = pts.every(p => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom);
                if (allIn) {
                    selectedNew.push(ent.id);
                }
            }
        });
        
        if (e.ctrlKey) {
            selectedNew.forEach(id => {
                if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
            });
        } else {
            state.selectedIds = selectedNew;
        }
        
        state.selectedEntityId = state.selectedIds.length > 0 ? state.selectedIds[state.selectedIds.length - 1] : null;
        
        state.isBoxSelecting = false;
        state.selectionBox = null;
        updatePropertyPanel();
        requestRedraw();
    }
    
    if (state.isDraggingVp) {
        state.isDraggingVp = false;
    }
    if (state.isMovingEntity) {
        state.isMovingEntity = false;
    }
    if (state.isDraggingGrip) {
        state.isDraggingGrip = null;
    }
});

// Zoom Handling
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    let zoom = Math.exp(wheel * zoomIntensity);

    const newZ = Math.max(0.2, Math.min(state.vw.z * zoom, 5));
    zoom = newZ / state.vw.z;

    state.vw.x = screenX - (screenX - state.vw.x) * zoom;
    state.vw.y = screenY - (screenY - state.vw.y) * zoom;
    state.vw.z = newZ;

    const zoomText = document.getElementById('zoom-indicator');
    zoomText.innerText = `${Math.round(state.vw.z * 100)}%`;
    zoomText.style.opacity = 1;
    clearTimeout(zoomText.timeout);
    zoomText.timeout = setTimeout(() => zoomText.style.opacity = 0, 1500);

    requestRedraw();
}, { passive: false });

// Init setup
resize();
saveState();

// -------- Influence Line Logic --------
function runInfluenceLine(targetEnt, type, component, ratio) {
    if (typeof buildFEModel !== 'function' || typeof solveFEModel !== 'function') {
        alert("Solver not built/loaded."); return;
    }
    const STEPS = 100;
    const influenceData = [];
    const pointsData = [];
    const walkableSegments = state.entities.filter(e => e.type === 'beam');
    if (walkableSegments.length === 0) return;

    let totalLength = 0;
    walkableSegments.forEach(b => {
        b._len = Math.hypot(b.p2.x - b.p1.x, b.p2.y - b.p1.y);
        totalLength += b._len;
    });

    for (let i = 0; i <= STEPS; i++) {
        const targetL = (i / STEPS) * totalLength;
        let point = null;
        let accumL = 0;
        for (let b of walkableSegments) {
            if (targetL >= accumL && targetL <= accumL + b._len + 1e-6) {
                const r = (targetL - accumL) / b._len;
                point = {
                    x: b.p1.x + (b.p2.x - b.p1.x) * r,
                    y: b.p1.y + (b.p2.y - b.p1.y) * r
                };
                break;
            }
            accumL += b._len;
        }

        if (!point) continue;

        const baseEnts = state.entities.filter(e => !['force', 'distload', 'moment'].includes(e.type));
        baseEnts.push({
            id: 'inf-load',
            type: 'force',
            p1: { x: point.x, y: point.y - state.gridSize }, 
            p2: point, // Force is applied at tip (p2) in this app
            magnitude: 1, 
            unit: '',
            angle: Math.PI / 2
        });

        const model = buildFEModel(baseEnts, state.gridSize);
        const results = solveFEModel(model);
        if (!results.success) {
            influenceData.push(0);
            pointsData.push(point);
            continue;
        }

        let val = 0;
        if (type === 'reaction') {
            const fePt = { x: targetEnt.p1.x / state.gridSize, y: -targetEnt.p1.y / state.gridSize };
            const node = results.model.nodes.find(n => distSolver(n, fePt) < 0.05);
            if (!node) console.log("Node not found!");
            if (node && node.reactions) {
                const alpha = node.supportAngle || 0;
                const s_ang = Math.sin(-alpha);
                const c_ang = Math.cos(-alpha);
                const fx = node.reactions.fx || 0;
                const fy = node.reactions.fy || 0;
                if (component === 'rx') val = fx * c_ang + fy * s_ang;
                else if (component === 'ry') val = -fx * s_ang + fy * c_ang;
                else if (component === 'mz') val = node.reactions.mz || 0;
            } else if (node) { console.log("Node found but no reactions!", node); }
        } else if (type === 'internal') {
            const fePt1 = { x: targetEnt.p1.x / state.gridSize, y: -targetEnt.p1.y / state.gridSize };
            const fePt2 = { x: targetEnt.p2.x / state.gridSize, y: -targetEnt.p2.y / state.gridSize };
            const targetFePt = {
                 x: fePt1.x + (fePt2.x - fePt1.x) * ratio,
                 y: fePt1.y + (fePt2.y - fePt1.y) * ratio
            };
            
            let matchElem = null;
            let subRatio = 0;
            for (let el of results.model.elements) {
                 const n1 = results.model.nodes[el.n1];
                 const n2 = results.model.nodes[el.n2];
                 const d = Math.hypot(n2.x - n1.x, n2.y - n1.y);
                 const d1 = Math.hypot(targetFePt.x - n1.x, targetFePt.y - n1.y);
                 const d2 = Math.hypot(n2.x - targetFePt.x, n2.y - targetFePt.y);
                 if (Math.abs(d - (d1 + d2)) < 1e-4) {
                     matchElem = el;
                     subRatio = d1 / d;
                     if (d1 < 1e-5 && subRatio === 0) continue; 
                     break;
                 }
            }
            if (!matchElem) {
                matchElem = results.model.elements.find(el => {
                    const n1 = results.model.nodes[el.n1];
                    return Math.hypot(targetFePt.x - n1.x, targetFePt.y - n1.y) < 1e-3;
                });
                subRatio = 0;
            }

            if (matchElem && matchElem.forces) {
                 const f = matchElem.forces; 
                 const V1 = f.V1;
                 const M1 = f.M1; 
                 const L = Math.hypot(results.model.nodes[matchElem.n2].x - results.model.nodes[matchElem.n1].x, results.model.nodes[matchElem.n2].y - results.model.nodes[matchElem.n1].y);
                 const x = subRatio * L;
                 if (component === 'v') val = V1;
                 else if (component === 'm') val = -M1 + V1 * x;
            }
        }
        influenceData.push(val);
        pointsData.push(point);
    }
    
    state.activeDiagram = 'influence';
    state.feResults = {
        success: true,
        isInfluence: true,
        influencePoints: pointsData,
        influenceValues: influenceData,
        infTarget: { type, component, entity: targetEnt }
    };
    
    document.getElementById('results-panel').classList.remove('hidden');
    document.querySelectorAll('.diagram-toggle-btn').forEach(b => {
        b.classList.remove('bg-indigo-600', 'text-white');
        if (b.dataset.diagram === 'influence') {
            b.classList.add('bg-indigo-600', 'text-white');
            b.classList.remove('hidden');
        } else {
            b.classList.add('bg-slate-100', 'text-slate-600');
        }
    });

    state.tool = 'select'; 
    document.querySelectorAll('.tool-btn').forEach(b => { 
        if(b.dataset.tool === 'select') b.classList.add('active');
        else b.classList.remove('active');
    });
    
    console.log("Influence Line calculated! Total points:", pointsData.length, "Vals:", influenceData);
    requestRedraw();
}
