// Initialize Canvas and Tools
const _origParseFloat = window.parseFloat;
window.parseFloat = function(val) {
    if (typeof val === 'string') val = val.replace(',', '.');
    return _origParseFloat(val);
};

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
    diagramMinMaxOnly: false,
    diagramTextSize: 10,
    hoveredDiagramValue: null, // format: { pt: {x,y}, value: number, label: string }
    mouseWorldPos: null,
    
    gridSize: 50,
    symbolScale: 1.0,
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
    if (state.symbolScale && state.symbolScale !== 1.0) {
        ctx.scale(state.symbolScale, state.symbolScale);
    }
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
            'prop-magnitude-container', 'prop-distload-range-container', 'prop-loadheight-container',
            'prop-angle-container', 'prop-length-container', 'prop-dim-container', 'prop-beam-rotate-container',
            'prop-text-container', 'prop-line-container', 'prop-arrow-container', 'prop-force-details-container', 'prop-stiffness-container', 'prop-image-container', 'prop-show-magnitude-container'
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
    const angCont = document.getElementById('prop-angle-container');
    const lenCont = document.getElementById('prop-length-container');
    const dimCont = document.getElementById('prop-dim-container');
    const beamRotCont = document.getElementById('prop-beam-rotate-container');
    const textCont = document.getElementById('prop-text-container');
    const lineCont = document.getElementById('prop-line-container');
    const arrowCont = document.getElementById('prop-arrow-container');
    const coordsysCont = document.getElementById('prop-coordsys-container');
    const stiffnessCont = document.getElementById('prop-stiffness-container');
    const sectionCont = document.getElementById('prop-section-container');
    const imageCont = document.getElementById('prop-image-container');
    const showMagCont = document.getElementById('prop-show-magnitude-container');
    
    magCont.classList.add('hidden');
    distRangeCont.classList.add('hidden');
    if (showMagCont) showMagCont.classList.add('hidden');
    angCont.classList.add('hidden');
    lenCont.classList.add('hidden');
    if (loadHeightCont) loadHeightCont.classList.add('hidden');
    dimCont.classList.add('hidden');
    beamRotCont.classList.add('hidden');
    if (textCont) textCont.classList.add('hidden');
    if (lineCont) lineCont.classList.add('hidden');
    if (arrowCont) arrowCont.classList.add('hidden');
    if (coordsysCont) coordsysCont.classList.add('hidden');
    if (stiffnessCont) stiffnessCont.classList.add('hidden');
    if (sectionCont) sectionCont.classList.add('hidden');
    if (imageCont) imageCont.classList.add('hidden');

    if (ent.type === 'image') {
        if (imageCont) {
            imageCont.classList.remove('hidden');
            const opacityInput = document.getElementById('prop-image-opacity');
            if (opacityInput) opacityInput.value = ent.opacity !== undefined ? ent.opacity : 0.4;
            const opVal = document.getElementById('prop-image-opacity-val');
            if (opVal) opVal.innerText = Math.round((ent.opacity !== undefined ? ent.opacity : 0.4) * 100);
        }
    }
    
    if (['force', 'moment', 'distload'].includes(ent.type)) {
        if (ent.type === 'distload') {
            distRangeCont.classList.remove('hidden');
            if (loadHeightCont) loadHeightCont.classList.remove('hidden');
            
            const showMagCont = document.getElementById('prop-show-magnitude-container');
            if (showMagCont) showMagCont.classList.remove('hidden');
            const showMagCheckbox = document.getElementById('prop-show-magnitude');
            if (showMagCheckbox) showMagCheckbox.checked = ent.showMagnitude !== false;
            
            const projectCheckbox = document.getElementById('prop-project-load');
            if (projectCheckbox) projectCheckbox.checked = ent.projectDownwards === true;
            
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
                ? '<option value="kN/m">kN/m</option><option value="">(None)</option>'
                : '<option value="kN">kN</option><option value="">(None)</option>';
                
            unitSelect.value = ent.unit !== undefined ? ent.unit : defaultUnit;
        } else {
            document.getElementById('prop-force-details-container').classList.add('hidden');
        }
    } else {
        document.getElementById('prop-force-details-container').classList.add('hidden');
    }

    if (['pin', 'roller', 'fixed', 'spring', 'rotspr', 'textLabel', 'force', 'coordsys'].includes(ent.type)) {
        angCont.classList.remove('hidden');
        document.getElementById('prop-angle').value = ent.angle ? Math.round(ent.angle * 180 / Math.PI) : 0;
    }

    if (['spring', 'rotspr'].includes(ent.type)) {
        document.getElementById('prop-stiffness-container').classList.remove('hidden');
        document.getElementById('prop-stiffness').value = ent.stiffness !== undefined ? ent.stiffness : 1000;
        
        if (ent.type === 'rotspr') {
            document.getElementById('prop-stiffness-label').textContent = 'Rotational Stiffness (k)';
            document.getElementById('prop-trans-stiffness-wrapper').classList.remove('hidden');
            document.getElementById('prop-axial-stiffness-wrapper').classList.remove('hidden');
            document.getElementById('prop-stiffness-trans').value = ent.stiffnessTrans !== undefined ? ent.stiffnessTrans : 0;
            document.getElementById('prop-stiffness-axial').value = ent.stiffnessAxial !== undefined ? ent.stiffnessAxial : 0;
            const unitSpan = document.querySelector('.prop-stiffness-unit');
            if (unitSpan) unitSpan.textContent = 'kNm/rad';
        } else {
            document.getElementById('prop-stiffness-label').textContent = 'Axial Stiffness (k)';
            document.getElementById('prop-trans-stiffness-wrapper').classList.remove('hidden');
            document.getElementById('prop-axial-stiffness-wrapper').classList.add('hidden');
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

    if (ent.type === 'beam') {
        beamRotCont.classList.remove('hidden');
        document.getElementById('prop-beam-rot-angle').value = 0;

        if (sectionCont) {
            sectionCont.classList.remove('hidden');
            const profile = ent.sectionProfile || (ent.sectionDefault === false ? 'custom' : 'default');
            const selEl = document.getElementById('prop-section-profile');
            if (selEl) selEl.value = profile;
            
            if (profile === 'default') {
                document.getElementById('prop-section-custom').classList.add('hidden');
            } else {
                document.getElementById('prop-section-custom').classList.remove('hidden');
                
                // If it's a standard profile, we could disable the inputs to signify they are read-only
                const readOnly = profile !== 'custom';
                document.getElementById('prop-section-a').readOnly = readOnly;
                document.getElementById('prop-section-i').readOnly = readOnly;
                document.getElementById('prop-section-e').readOnly = readOnly;
                
                if (readOnly) {
                    document.getElementById('prop-section-a').classList.add('bg-slate-100', 'text-slate-500');
                    document.getElementById('prop-section-i').classList.add('bg-slate-100', 'text-slate-500');
                    document.getElementById('prop-section-e').classList.add('bg-slate-100', 'text-slate-500');
                } else {
                    document.getElementById('prop-section-a').classList.remove('bg-slate-100', 'text-slate-500');
                    document.getElementById('prop-section-i').classList.remove('bg-slate-100', 'text-slate-500');
                    document.getElementById('prop-section-e').classList.remove('bg-slate-100', 'text-slate-500');
                }
            }
            
            // Display values in MPa, mm2, mm4. 
            // Internal storage remains Pa, m2, m4.
            document.getElementById('prop-section-e').value = (ent.E || 200e9) / 1e6;
            document.getElementById('prop-section-a').value = ((ent.A || 0.01) * 1e6).toFixed(0);
            document.getElementById('prop-section-i').value = ((ent.I || 1e-4) * 1e12).toFixed(0);
        }
        
        if (ent.type === 'beam' && document.getElementById('prop-beam-type')) {
            document.getElementById('prop-beam-type').parentElement.classList.remove('hidden');
            let bType = 'beam';
            if (ent.isTruss) bType = 'truss';
            if (ent.beamType) bType = ent.beamType;
            document.getElementById('prop-beam-type').value = bType;
            document.getElementById('prop-beam-end-dots').checked = !ent.hideEndDots;
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
        const unitLabel = document.getElementById('prop-dim-units-label');
        if (unitLabel) unitLabel.innerText = ent.type === 'angdim' ? (ent.dimRadians ? 'Show Units (rad)' : 'Show Units (deg)') : 'Show Units (m)';
        const radWrapper = document.getElementById('prop-dim-radians-wrapper');
        if (radWrapper) {
            if (ent.type === 'angdim') {
                radWrapper.classList.remove('hidden');
                document.getElementById('prop-dim-radians').checked = ent.dimRadians === true;
            } else {
                radWrapper.classList.add('hidden');
            }
        }
        document.getElementById('prop-dim-text').value = ent.dimText || '';
        document.getElementById('prop-dim-units').checked = ent.dimUnits !== false; // Default true
        document.getElementById('prop-dim-decimals').value = ent.dimDecimals !== undefined ? ent.dimDecimals : (ent.type === 'angdim' ? 1 : 3);
        document.getElementById('prop-dim-lines').checked = ent.dimLines !== false; // Default true
        document.getElementById('prop-dim-short-lines').checked = ent.dimShortLines === true; // Default false
        document.getElementById('prop-dim-short-length').value = ent.dimShortLength !== undefined ? ent.dimShortLength : 12;
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
            document.getElementById('prop-arrow-filled').checked = ent.filledHead || false;
            document.getElementById('prop-arrow-double').checked = ent.doubleHead || false;
        } else {
            arrowCont.classList.add('hidden');
        }
    }

    if (coordsysCont) {
        if (ent.type === 'coordsys') {
            coordsysCont.classList.remove('hidden');
            document.getElementById('prop-coordsys-xtext').value = ent.xLabel !== undefined ? ent.xLabel : 'x';
            document.getElementById('prop-coordsys-ytext').value = ent.yLabel !== undefined ? ent.yLabel : 'y';
            document.getElementById('prop-coordsys-weight').value = ent.weight || 2;
            document.getElementById('prop-coordsys-color').value = ent.color || '#000000';
            document.getElementById('prop-coordsys-flip-x').checked = ent.flipX || false;
            document.getElementById('prop-coordsys-flip-y').checked = ent.flipY || false;
            document.getElementById('prop-coordsys-scale').value = ent.csScale || 1.0;
        } else {
            coordsysCont.classList.add('hidden');
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

document.getElementById('prop-image-opacity').addEventListener('input', (e) => {
    document.getElementById('prop-image-opacity-val').innerText = Math.round(e.target.value * 100);
    updateSelectedEntities(ent => {
        if (ent.type === 'image') {
            ent.opacity = parseFloat(e.target.value);
        }
    });
});

document.getElementById('btn-calibrate-image').addEventListener('click', () => {
    if (state.selectedEntityId) {
        state.tool = 'calibrate';
        state.calibratePoints = [];
        state.calibratingEntityId = state.selectedEntityId;
        wrapper.style.cursor = 'crosshair';
    }
});

document.getElementById('prop-distload-start').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        ent.startMagnitude = e.target.value;
    });
});

document.getElementById('prop-show-magnitude')?.addEventListener('change', (e) => {
    updateSelectedEntities(ent => {
        ent.showMagnitude = e.target.checked;
    });
});

document.getElementById('prop-project-load')?.addEventListener('change', (e) => {
    updateSelectedEntities(ent => {
        ent.projectDownwards = e.target.checked;
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
        if (['spring', 'rotspr'].includes(ent.type)) {
            ent.stiffnessTrans = parseFloat(e.target.value) || 0;
        }
    });
});

document.getElementById('prop-stiffness-axial').addEventListener('input', (e) => {
    updateSelectedEntities(ent => {
        if (ent.type === 'rotspr') {
            ent.stiffnessAxial = parseFloat(e.target.value) || 0;
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

['prop-section-profile', 'prop-section-e', 'prop-section-a', 'prop-section-i'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = id === 'prop-section-profile' ? 'change' : 'input';
    el.addEventListener(eventName, (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'beam') {
                if (id === 'prop-section-profile') {
                    const profile = e.target.value;
                    ent.sectionProfile = profile;
                    ent.sectionDefault = (profile === 'default');
                    
                    if (profile === 'default') {
                        document.getElementById('prop-section-custom').classList.add('hidden');
                        delete ent.E;
                        delete ent.A;
                        delete ent.I;
                    } else {
                        document.getElementById('prop-section-custom').classList.remove('hidden');
                        
                        ent.E = ent.E || 200e9; // Keep existing E or default to 200GPa steel
                        
                        const readOnly = profile !== 'custom';
                        document.getElementById('prop-section-a').readOnly = readOnly;
                        document.getElementById('prop-section-i').readOnly = readOnly;
                        document.getElementById('prop-section-e').readOnly = readOnly;
                        
                        if (readOnly) {
                            document.getElementById('prop-section-a').classList.add('bg-slate-100', 'text-slate-500');
                            document.getElementById('prop-section-i').classList.add('bg-slate-100', 'text-slate-500');
                            document.getElementById('prop-section-e').classList.add('bg-slate-100', 'text-slate-500');
                            
                            // Load from library
                            if (PROFILE_LIBRARY[profile]) {
                                ent.A = PROFILE_LIBRARY[profile].a / 1e6; // to m2
                                ent.I = PROFILE_LIBRARY[profile].i / 1e12; // to m4
                                
                                document.getElementById('prop-section-a').value = PROFILE_LIBRARY[profile].a.toFixed(0);
                                document.getElementById('prop-section-i').value = PROFILE_LIBRARY[profile].i.toFixed(0);
                            }
                        } else {
                            document.getElementById('prop-section-a').classList.remove('bg-slate-100', 'text-slate-500');
                            document.getElementById('prop-section-i').classList.remove('bg-slate-100', 'text-slate-500');
                            document.getElementById('prop-section-e').classList.remove('bg-slate-100', 'text-slate-500');
                            ent.A = ent.A || 0.01;
                            ent.I = ent.I || 1e-4;
                            
                            document.getElementById('prop-section-a').value = (ent.A * 1e6).toFixed(0);
                            document.getElementById('prop-section-i').value = (ent.I * 1e12).toFixed(0);
                        }
                        document.getElementById('prop-section-e').value = (ent.E / 1e6).toFixed(0);
                    }
                } else if (id === 'prop-section-e') ent.E = parseFloat(e.target.value) * 1e6; // MPa to Pa
                else if (id === 'prop-section-a') ent.A = parseFloat(e.target.value) / 1e6; // mm2 to m2
                else if (id === 'prop-section-i') ent.I = parseFloat(e.target.value) / 1e12; // mm4 to m4
            }
        });
        // Clear cached solver results when stiffness changes
        if (id !== 'prop-section-profile' || e.target.value !== 'default') {
            state.feResults = null;
        }
    });
});

['prop-dim-text', 'prop-dim-units', 'prop-dim-radians', 'prop-dim-decimals', 'prop-dim-lines', 'prop-dim-short-lines', 'prop-dim-short-length'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        updateSelectedEntities(ent => {
            if (['dimension', 'angdim'].includes(ent.type)) {
                if (id === 'prop-dim-text') ent.dimText = e.target.value;
                if (id === 'prop-dim-units') ent.dimUnits = e.target.checked;
                if (id === 'prop-dim-radians') { ent.dimRadians = e.target.checked; const ul = document.getElementById('prop-dim-units-label'); if (ul) ul.innerText = ent.dimRadians ? 'Show Units (rad)' : 'Show Units (deg)'; }
                if (id === 'prop-dim-decimals') {
                    const dec = parseInt(e.target.value);
                    ent.dimDecimals = isNaN(dec) ? (ent.type === 'angdim' ? 1 : 3) : dec;
                }
                if (id === 'prop-dim-lines') ent.dimLines = e.target.checked;
                if (id === 'prop-dim-short-lines') ent.dimShortLines = e.target.checked;
                if (id === 'prop-dim-short-length') {
                    const len = parseInt(e.target.value);
                    ent.dimShortLength = isNaN(len) ? 12 : len;
                }
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

['prop-arrow-weight', 'prop-arrow-color', 'prop-arrow-dashed', 'prop-arrow-scale', 'prop-arrow-filled', 'prop-arrow-double'].forEach(id => {
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
                if (id === 'prop-arrow-filled') ent.filledHead = e.target.checked;
                if (id === 'prop-arrow-double') ent.doubleHead = e.target.checked;
            }
        });
    });
});

['prop-coordsys-xtext', 'prop-coordsys-ytext', 'prop-coordsys-weight', 'prop-coordsys-color', 'prop-coordsys-flip-x', 'prop-coordsys-flip-y', 'prop-coordsys-scale'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = ['prop-coordsys-color', 'prop-coordsys-xtext', 'prop-coordsys-ytext', 'prop-coordsys-scale'].includes(id) ? 'input' : 'change';
    el.addEventListener(eventName, (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'coordsys') {
                if (id === 'prop-coordsys-xtext') ent.xLabel = e.target.value;
                if (id === 'prop-coordsys-ytext') ent.yLabel = e.target.value;
                if (id === 'prop-coordsys-weight') ent.weight = parseFloat(e.target.value);
                if (id === 'prop-coordsys-color') ent.color = e.target.value;
                if (id === 'prop-coordsys-flip-x') ent.flipX = e.target.checked;
                if (id === 'prop-coordsys-flip-y') ent.flipY = e.target.checked;
                if (id === 'prop-coordsys-scale') { const v = parseFloat(e.target.value); if (v > 0) ent.csScale = v; }
            }
        });
    });
});

const typeEl = document.getElementById('prop-beam-type');
if (typeEl) {
    typeEl.addEventListener('change', (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'beam') {
                ent.beamType = e.target.value;
                ent.isTruss = (e.target.value === 'truss');
            }
        });
    });
}

const endDotsEl = document.getElementById('prop-beam-end-dots');
if (endDotsEl) {
    endDotsEl.addEventListener('change', (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'beam') ent.hideEndDots = !e.target.checked;
        });
    });
}
['prop-beam-p1-x', 'prop-beam-p1-y', 'prop-beam-p2-x', 'prop-beam-p2-y'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
        updateSelectedEntities(ent => {
            if (ent.type === 'beam') {
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
        if (ent.type !== 'beam') return;

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
        
        if (state.tool === 'arrayload') {
            const countStr = prompt("How many discrete loads in this array?", "5");
            const count = parseInt(countStr, 10);
            if (!isNaN(count) && count >= 2) {
                state.arrayLoadCount = count;
            } else {
                state.tool = 'select';
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('.tool-btn[data-tool="select"]')?.classList.add('active');
            }
        }
        
        state.selectedEntityId = null;
        state.calibratePoints = [];
        state.calibratingEntityId = null;
        
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
    if (e.target.tagName !== 'INPUT' && e.key.length === 1 && /[0-9.,-]/.test(e.key)) {
        if (snapMode.trackAxis && snapMode.trackRef && !['select', 'dimension'].includes(state.tool)) {
            // Smart tracking distance configuration has priority when actively tracking an axis!
            state.isTypingDistance = true;
            let trackMult = 1;
            if (snapMode.trackAxis.vx !== undefined) {
                const dot = (state.cursorPt.x - snapMode.trackRef.x) * snapMode.trackAxis.vx + (state.cursorPt.y - snapMode.trackRef.y) * snapMode.trackAxis.vy;
                trackMult = Math.sign(dot) || 1;
            }
            state.distanceTrackDir = {
                x: Math.sign(state.cursorPt.x - snapMode.trackRef.x) || 1,
                y: Math.sign(state.cursorPt.y - snapMode.trackRef.y) || 1,
                mult: trackMult
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
            (state.drawingStep === 1 && ['beam', 'distload', 'dimension', 'arrayload'].includes(state.tempEntity.type)) || 
            (state.drawingStep === 3 && state.tool === 'chaindim')
        )) {
            const lp = document.getElementById('cad-input-panel');
            const inp = document.getElementById('cad-input');
            document.getElementById('cad-input-label').innerText = 'Length';
            lp.classList.remove('hidden');
            inp.focus();
            inp.value += e.key;
            e.preventDefault();
            return;
        }
    }

    // Escape action
    if (e.key === 'Escape') {
        if (state.tool === 'calibrate') {
            state.tool = 'select';
            state.calibratePoints = [];
            state.calibratingEntityId = null;
            wrapper.style.cursor = 'default';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
            const selectBtn = document.getElementById('tool-select');
            if (selectBtn) selectBtn.classList.add('active-tool');
            requestRedraw();
            return;
        }
        if (state.isTypingDistance) {
            state.isTypingDistance = false;
            document.getElementById('cad-input-panel').classList.add('hidden');
            document.getElementById('cad-input').blur();
            requestRedraw();
            return;
        }
        if (state.drawingStep > 0) {
            if (state.tool === 'chaindim' && state.drawingStep === 3) {
                // If it's a chain dimension, escaping during step 3 just terminates the chain without an undo pop
                state.drawingStep = 0;
                state.tempEntity = null;
                document.getElementById('cad-input-panel').classList.add('hidden');
                document.querySelector(`.tool-btn[data-tool="select"]`).click();
            } else {
                state.drawingStep = 0;
                state.tempEntity = null;
                document.getElementById('cad-input-panel').classList.add('hidden');
                history.undo.pop(); 
            }
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

// Native Paste Event for Images
window.addEventListener('paste', (e) => {
    // Determine target so we don't paste images when inside an input field
    if (e.target && e.target.tagName === 'INPUT') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                const img = new Image();
                img.onload = () => {
                    saveState();
                    const w = img.width;
                    const h = img.height;
                    
                    // Center roughly in current viewport
                    const centerX = -state.vw.x / state.vw.z + (wrapper.clientWidth / 2) / state.vw.z;
                    const centerY = -state.vw.y / state.vw.z + (wrapper.clientHeight / 2) / state.vw.z;
                    
                    // We'll insert it at a modest scale if it's very large
                    const maxScaleW = (wrapper.clientWidth / state.vw.z) * 0.8;
                    const widthInWorld = Math.min(w, maxScaleW);
                    const scale = widthInWorld / w;
                    
                    const newEnt = {
                        id: generateId(),
                        type: 'image',
                        p1: { x: centerX - (w * scale) / 2, y: centerY - (h * scale) / 2 },
                        p2: { x: centerX + (w * scale) / 2, y: centerY + (h * scale) / 2 },
                        dataUrl: dataUrl,
                        opacity: 0.4
                    };
                    // unshift to put it behind all other drawn lines
                    state.entities.unshift(newEnt);
                    requestRedraw();
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(blob);
            break; // only handle first image
        }
    }
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
            consoleOut.textContent += "FE-System generated successfully.\n";
            
            lucide.createIcons();
            
            // Store results in global state and show results toolbar
            state.feResults = results;
            setResultsMode('fe');
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

// Shows only the buttons relevant to the current analysis type ('fe' or 'influence')
function setResultsMode(mode) {
    document.querySelectorAll('.diagram-toggle-btn').forEach(b => {
        const isInf = b.dataset.diagram === 'influence';
        b.classList.toggle('hidden', mode === 'influence' ? !isInf : isInf);
    });
    const minmaxWrap = document.getElementById('diagram-minmax-cb').closest('div');
    if (minmaxWrap) minmaxWrap.classList.toggle('hidden', mode === 'influence');
    document.getElementById('btn-generate-report').classList.toggle('hidden', mode === 'influence');
}

document.getElementById('btn-generate-report').addEventListener('click', () => {
    if (!state.feResults || !state.feResults.success) return;

    // Save current state
    const originalDiagram = state.activeDiagram;
    const origShowGrid = styleSettings.showGrid;
    const origSelected = state.selectedEntityId;
    const origMinMax = state.diagramMinMaxOnly;
    
    // Disable grid, axes, and selections for clean export
    styleSettings.showGrid = false;
    state.selectedEntityId = null;
    state.showAxes = false;
    state.diagramMinMaxOnly = true;

    // Up-sample canvas resolution heavily for export printing
    const SCALE_FACTOR = 2;
    canvas.width = wrapper.clientWidth * SCALE_FACTOR;
    canvas.height = wrapper.clientHeight * SCALE_FACTOR;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset scale
    ctx.scale(SCALE_FACTOR, SCALE_FACTOR);
    
    // Function to get image data safely and cropped
    const getImageData = (diagramType) => {
        state.activeDiagram = diagramType;
        render(); // Force synchronous render
        
        // Export exactly what the user sees, capturing with white background
        const expCanvas = document.createElement('canvas');
        expCanvas.width = canvas.width;
        expCanvas.height = canvas.height;
        const eCtx = expCanvas.getContext('2d');
        eCtx.fillStyle = '#ffffff';
        eCtx.fillRect(0, 0, expCanvas.width, expCanvas.height);
        eCtx.drawImage(canvas, 0, 0);
        
        // Auto-Crop logic: Find bounding box of non-white pixels
        const pixels = eCtx.getImageData(0, 0, expCanvas.width, expCanvas.height);
        const l = pixels.data.length;
        let bounds = { top: null, left: null, right: null, bottom: null };
        
        for (let i = 0; i < l; i += 4) {
            if (pixels.data[i] !== 255 || pixels.data[i+1] !== 255 || pixels.data[i+2] !== 255) {
                const x = (i / 4) % expCanvas.width;
                const y = Math.floor((i / 4) / expCanvas.width);

                if (bounds.top === null) bounds.top = y;
                if (bounds.left === null || x < bounds.left) bounds.left = x;
                if (bounds.right === null || x > bounds.right) bounds.right = x;
                if (bounds.bottom === null || y > bounds.bottom) bounds.bottom = y;
            }
        }
        
        // If image is blank, fallback to full uncropped canvas
        if (bounds.top === null) return { url: expCanvas.toDataURL('image/jpeg', 0.9), w: expCanvas.width, h: expCanvas.height };
        
        const pad = 40 * SCALE_FACTOR; // adjust padding to the new resolution
        const bw = bounds.right - bounds.left;
        const bh = bounds.bottom - bounds.top;
        if (bw <= 0 || bh <= 0) return { url: expCanvas.toDataURL('image/jpeg', 0.9), w: expCanvas.width, h: expCanvas.height };
        const trimWidth = bw + pad * 2;
        const trimHeight = bh + pad * 2;
        
        const trimmed = document.createElement('canvas');
        trimmed.width = trimWidth;
        trimmed.height = trimHeight;
        const tCtx = trimmed.getContext('2d');
        tCtx.fillStyle = '#ffffff';
        tCtx.fillRect(0, 0, trimWidth, trimHeight);
        tCtx.drawImage(expCanvas, bounds.left, bounds.top, bw, bh, pad, pad, bw, bh);
        
        return { url: trimmed.toDataURL('image/jpeg', 0.9), w: trimWidth, h: trimHeight };
    };

    // Capture the views
    const imgBase = getImageData(null);
    const imgDeflection = getImageData('deflection');
    const imgReactions = getImageData('reactions');
    const imgAfd = getImageData('afd');
    const imgSfd = getImageData('sfd');
    const imgBmd = getImageData('bmd');

    // Restore state
    state.activeDiagram = originalDiagram;
    styleSettings.showGrid = origShowGrid;
    state.selectedEntityId = origSelected;
    state.showAxes = true;
    state.diagramMinMaxOnly = origMinMax;
    
    // Restore resolution safely
    resize();
    render();

    // Generate PDF directly
    if (!window.jspdf) {
        alert("jsPDF library not loaded. Please ensure internet connection.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;

    let currentY = margin;

    // Title
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42);
    doc.text("FE-Sketch Analysis Report", margin, currentY);

    currentY += 8;
    // Meta string
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text("Generated on: " + new Date().toLocaleString(), margin, currentY);

    currentY += 15;

    const addDiagramToPDF = (imgObj, title) => {
        if (!imgObj || !imgObj.url) return;
        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59);
        const titleHeight = 8;
        let drawW = contentWidth;
        let drawH = (imgObj.h / imgObj.w) * drawW;

        if (currentY + titleHeight + drawH + 10 > pageHeight - margin) {
            doc.addPage();
            currentY = margin;
        }

        doc.text(title, margin, currentY);
        currentY += titleHeight;
        doc.addImage(imgObj.url, "JPEG", margin, currentY, drawW, drawH);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.5);
        doc.rect(margin, currentY, drawW, drawH);
        currentY += drawH + 15;
    };

    addDiagramToPDF(imgBase, "1. Structural Geometry & Applied Loads");
    addDiagramToPDF(imgDeflection, "2. Deflected Shape");
    addDiagramToPDF(imgReactions, "3. Reactions");
    addDiagramToPDF(imgAfd, "4. Axial Force Diagram (AFD)");
    addDiagramToPDF(imgSfd, "5. Shear Force Diagram (SFD)");
    addDiagramToPDF(imgBmd, "6. Bending Moment Diagram (BMD)");

    // Save directly to the user's computer
    doc.save("FE-Sketch-Analysis-Report.pdf");
});


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

const diagMinMaxCb = document.getElementById('diagram-minmax-cb');
if (diagMinMaxCb) {
    diagMinMaxCb.addEventListener('change', (e) => {
        state.diagramMinMaxOnly = e.target.checked;
        requestRedraw();
    });
}

const diagTextSizeSlider = document.getElementById('diagram-text-size-slider');
if (diagTextSizeSlider) {
    diagTextSizeSlider.addEventListener('input', (e) => {
        state.diagramTextSize = parseInt(e.target.value) || 12;
        requestRedraw();
    });
    diagTextSizeSlider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = parseInt(diagTextSizeSlider.step) || 1;
        let val = parseInt(diagTextSizeSlider.value);
        if (e.deltaY < 0) val += step;
        else val -= step;
        val = Math.max(parseInt(diagTextSizeSlider.min), Math.min(parseInt(diagTextSizeSlider.max), val));
        diagTextSizeSlider.value = val;
        state.diagramTextSize = val;
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

                // Loads are always in kN - relabel old sketches saved with N units (the solver already treated them as kN)
                state.entities.forEach(ent => {
                    if (ent.unit === 'N') ent.unit = 'kN';
                    else if (ent.unit === 'N/m') ent.unit = 'kN/m';
                });

                // Avoid ID collisions by syncing entityCounter
                let maxId = 0;
                state.entities.forEach(ent => {
                    if (ent.id && typeof ent.id === 'string' && ent.id.startsWith('ent_')) {
                        const num = parseInt(ent.id.replace('ent_', ''), 10);
                        if (!isNaN(num) && num > maxId) {
                            maxId = num;
                        }
                    }
                });

                // Auto-cleanup imported points: If they are visually close to the grid,
                // snap them perfectly to fix microscopic slopes causing accidental normal forces.
                state.entities.forEach(ent => {
                    ['p1', 'p2', 'p3'].forEach(ptKey => {
                        const pt = ent[ptKey];
                        if (pt) {
                            const sx = Math.round(pt.x / state.gridSize) * state.gridSize;
                            const sy = Math.round(pt.y / state.gridSize) * state.gridSize;
                            if (Math.abs(pt.x - sx) < 5) pt.x = sx;
                            if (Math.abs(pt.y - sy) < 5) pt.y = sy;
                        }
                    });
                });

                entityCounter = Math.max(entityCounter, maxId);

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
        drawFEDiagrams(ctx, state.feResults, state.activeDiagram, state.diagramScale, state.mouseWorldPos, state);
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
    link.href = expCanvas.toDataURL('image/jpeg');
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
document.getElementById('vis-annotations').addEventListener('change', requestRedraw);
document.getElementById('vis-dimensions').addEventListener('change', requestRedraw);

// AI Import Logic

// Downscale before upload: full-res photos make the API call much slower
function downscaleSketchImage(dataUrl, maxDim = 1024) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            const cctx = c.getContext('2d');
            cctx.fillStyle = '#ffffff'; // flatten transparency for JPEG
            cctx.fillRect(0, 0, c.width, c.height);
            cctx.drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

async function analyzeSketchDataUrl(dataUrl) {
    document.getElementById('ai-loading-overlay').classList.remove('hidden');
    const base64 = await downscaleSketchImage(dataUrl);

            try {
                const response = await fetch('/api/scan-sketch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageBase64: base64 })
                });

                if(!response.ok) {
                    if (response.status === 405 || response.status === 404) {
                        throw new Error("The AI endpoint isn't running. Static servers (e.g. Live Server) can't execute it — start the app with 'node server.js' and open http://localhost:3000 instead.");
                    }
                    const errData = await response.json().catch(()=>({}));
                    throw new Error(errData.error || 'Server returned ' + response.status);
                }

                const data = await response.json();
                
                const gs = state.gridSize; // Default 50
                
                let nodes = data.nodes || [];
                if(nodes.length === 0) throw new Error("No nodes found in image.");
                
                // Anchor the leftmost (then lowest) node at world origin (0,0)
                let anchor = nodes[0];
                nodes.forEach(n => {
                    if (n[0] < anchor[0] || (n[0] === anchor[0] && n[1] < anchor[1])) anchor = n;
                });
                const offsetX = -anchor[0] * gs;
                const offsetY = anchor[1] * gs;

                state.entities = []; 
                let idCounter = 1;
                
                const nodeCoords = nodes.map(n => ({
                    x: offsetX + n[0] * gs,
                    y: offsetY - n[1] * gs
                }));

                // Merge collinear beam chains: loads often create intermediate nodes
                // that needlessly split one physical beam into several elements.
                let elements = (data.elements || []).map(el => [el[0], el[1]]);
                const supportNodes = new Set(Object.keys(data.supports || {}).map(Number));
                let mergedSomething = true;
                while (mergedSomething) {
                    mergedSomething = false;
                    outer:
                    for (let i = 0; i < elements.length; i++) {
                        for (let j = i + 1; j < elements.length; j++) {
                            const shared = elements[i].find(n => elements[j].includes(n));
                            if (shared === undefined || supportNodes.has(shared)) continue;
                            // only merge if the node connects exactly these two elements
                            if (elements.filter(el => el.includes(shared)).length !== 2) continue;
                            const a = elements[i][0] === shared ? elements[i][1] : elements[i][0];
                            const c = elements[j][0] === shared ? elements[j][1] : elements[j][0];
                            const pA = nodes[a], pB = nodes[shared], pC = nodes[c];
                            if (!pA || !pB || !pC) continue;
                            const cross = (pB[0]-pA[0])*(pC[1]-pA[1]) - (pB[1]-pA[1])*(pC[0]-pA[0]);
                            const lenAB = Math.hypot(pB[0]-pA[0], pB[1]-pA[1]);
                            const lenAC = Math.hypot(pC[0]-pA[0], pC[1]-pA[1]);
                            if (Math.abs(cross) > 1e-3 * lenAB * lenAC) continue; // not collinear
                            elements[i] = [a, c];
                            elements.splice(j, 1);
                            mergedSomething = true;
                            break outer;
                        }
                    }
                }

                elements.forEach(el => {
                    const p1 = nodeCoords[el[0]];
                    const p2 = nodeCoords[el[1]];
                    if(p1 && p2) {
                        state.entities.push({
                            id: Date.now() + idCounter++,
                            type: 'beam',
                            p1: {x: p1.x, y: p1.y},
                            p2: {x: p2.x, y: p2.y}
                        });
                    }
                });

                if(data.supports) {
                    Object.keys(data.supports).forEach(nIdx => {
                        const coord = nodeCoords[nIdx];
                        const typeRaw = data.supports[nIdx];
                        let type = 'fixed';
                        if(typeRaw === 'pinned' || typeRaw === 'pin') type = 'pin';
                        else if(typeRaw === 'slider' || typeRaw.includes('roller_x')) type = 'slider';
                        else if(typeRaw.includes('roller')) type = 'roller';
                        
                        if(coord) {
                            state.entities.push({
                                id: Date.now() + idCounter++,
                                type: type,
                                p1: {x: coord.x, y: coord.y},
                                angle: 0
                            });
                        }
                    });
                }

                if(data.loads) {
                    data.loads.forEach(ld => {
                        const mag = String(ld.magnitude || 10);
                        if (ld.type === 'point' && nodeCoords[ld.node]) {
                            const pt = nodeCoords[ld.node];
                            const rad = (ld.angle_deg !== undefined ? ld.angle_deg : -90) * Math.PI / 180;
                            const dir = { x: Math.cos(rad), y: -Math.sin(rad) }; // sketch Y-up -> canvas Y-down
                            const len = 40;
                            state.entities.push({
                                id: Date.now() + idCounter++,
                                type: 'force',
                                p1: { x: pt.x - dir.x * len, y: pt.y - dir.y * len },
                                p2: { x: pt.x, y: pt.y },
                                angle: Math.atan2(dir.y, dir.x),
                                magnitude: mag
                            });
                        } else if (ld.type === 'moment' && nodeCoords[ld.node]) {
                            const pt = nodeCoords[ld.node];
                            state.entities.push({
                                id: Date.now() + idCounter++,
                                type: 'moment',
                                p1: { x: pt.x, y: pt.y },
                                angle: 0,
                                magnitude: mag
                            });
                        } else if (ld.type === 'distributed' && nodeCoords[ld.start_node] && nodeCoords[ld.end_node]) {
                            const a = nodeCoords[ld.start_node];
                            const b = nodeCoords[ld.end_node];
                            state.entities.push({
                                id: Date.now() + idCounter++,
                                type: 'distload',
                                p1: { x: a.x, y: a.y },
                                p2: { x: b.x, y: b.y },
                                angle: 0,
                                magnitude: mag
                            });
                        }
                    });
                }

                state.selectedIds = [];
                requestRedraw();
            } catch(fetchErr) {
                alert("Failed to analyze image with API: " + fetchErr.message);
            } finally {
                document.getElementById('ai-loading-overlay').classList.add('hidden');
            }
}

document.getElementById('ai-import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => analyzeSketchDataUrl(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
});

// AI import chooser modal
document.getElementById('btn-ai-import').addEventListener('click', () => {
    document.getElementById('ai-import-modal').classList.remove('hidden');
});
document.getElementById('btn-close-ai-import').addEventListener('click', () => {
    document.getElementById('ai-import-modal').classList.add('hidden');
});
document.getElementById('btn-ai-own-file').addEventListener('click', () => {
    document.getElementById('ai-import-modal').classList.add('hidden');
    document.getElementById('ai-import-input').click();
});
document.querySelectorAll('.ai-example-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.getElementById('ai-import-modal').classList.add('hidden');
        try {
            const resp = await fetch(btn.dataset.src);
            if (!resp.ok) throw new Error("Example image not found (" + btn.dataset.src + ").");
            const blob = await resp.blob();
            const dataUrl = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => rej(new Error("Could not read example image."));
                r.readAsDataURL(blob);
            });
            analyzeSketchDataUrl(dataUrl);
        } catch (err) {
            alert(err.message);
        }
    });
});


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
                } else if (snapMode.trackAxis.vx !== undefined) {
                    let m = state.distanceTrackDir.mult;
                    if (val < 0) m *= -1;
                    finalPt.x += dist * m * snapMode.trackAxis.vx;
                    finalPt.y += dist * m * snapMode.trackAxis.vy;
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
                if (state.drawingStep === 1 && state.tempEntity && ['beam', 'distload', 'dimension', 'arrayload'].includes(state.tempEntity.type)) {
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
                    if (state.tool === 'arrayload') {
                        const pt1 = state.tempEntity.p1;
                        const pt2 = state.tempEntity.p2;
                        const count = state.arrayLoadCount || 5;
                        const dx = (pt2.x - pt1.x);
                        const dy = (pt2.y - pt1.y);
                        const groupId = 'group_' + generateId();
                        state.selectedIds = [];
                        
                        for (let i = 0; i < count; i++) {
                            const px = pt1.x + dx * i;
                            const py = pt1.y + dy * i;
                            const visualLen = 40 / state.vw.z;
                            const newForce = {
                                id: generateId(),
                                type: 'force',
                                p2: { x: px, y: py },
                                p1: { x: px, y: py - visualLen },
                                angle: Math.PI / 2,
                                magnitude: '10',
                                groupId: groupId
                            };
                            state.entities.push(newForce);
                            state.selectedIds.push(newForce.id);
                        }
                        state.selectedEntityId = state.selectedIds[state.selectedIds.length - 1];
                    } else {
                        state.entities.push({...state.tempEntity});
                        state.selectedIds = [state.tempEntity.id];
                        state.selectedEntityId = state.tempEntity.id;
                    }
                    state.drawingStep = 0;
                    state.tempEntity = null;
                    document.getElementById('cad-input-panel').classList.add('hidden');
                    
                    document.querySelector('.tool-btn[data-tool="select"]').click();
                    updatePropertyPanel();
                }
                requestRedraw();
            } else if (state.drawingStep === 3 && state.tool === 'chaindim' && state.tempEntity) {
                const angle = Math.atan2(state.tempEntity.p2.y - state.tempEntity.p1.y, state.tempEntity.p2.x - state.tempEntity.p1.x);
                const realLen = val * state.gridSize;
                state.tempEntity.p2 = {
                    x: state.tempEntity.p1.x + realLen * Math.cos(angle),
                    y: state.tempEntity.p1.y + realLen * Math.sin(angle)
                };
                
                const dx = state.tempEntity.p2.x - state.tempEntity.p1.x;
                const dy = state.tempEntity.p2.y - state.tempEntity.p1.y;
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                    const nx = -dy / len;
                    const ny = dx / len;
                    state.tempEntity.p3 = {
                        x: state.tempEntity.p1.x + state.chainDimOffset * nx,
                        y: state.tempEntity.p1.y + state.chainDimOffset * ny
                    };
                }
                
                state.entities.push({...state.tempEntity});
                
                state.tempEntity = {
                    id: generateId(),
                    type: 'dimension',
                    p1: {...state.tempEntity.p2},
                    p2: snap(state.cursorPt),
                    groupId: state.chainDimGroupId
                };
                
                document.getElementById('cad-input').value = '';
                document.getElementById('cad-input-panel').classList.add('hidden');
                requestRedraw();
                return;
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
    pin: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    roller: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    fixed: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    slider: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    hinge: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    spring: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    rotspr: { color: '#27272a', alpha: 1.0, rgba: 'rgba(39, 39, 42, 1.0)', weight: 2 },
    force: { color: '#e74c3c', alpha: 1.0, rgba: 'rgba(231, 76, 60, 1.0)', weight: 2, text: 12 },
    distload: { color: '#e74c3c', alpha: 1.0, rgba: 'rgba(231, 76, 60, 1.0)', weight: 2, text: 12 },
    moment: { color: '#e74c3c', alpha: 1.0, rgba: 'rgba(231, 76, 60, 1.0)', weight: 2, text: 12 },
    dimension: { color: '#64748b', alpha: 1.0, rgba: 'rgba(100, 116, 139, 1.0)', weight: 1, text: 12 },
    angdim: { color: '#64748b', alpha: 1.0, rgba: 'rgba(100, 116, 139, 1.0)', weight: 1, text: 12 },
    textLabel: { color: '#000000', alpha: 1.0, rgba: 'rgba(0, 0, 0, 1.0)', text: 16 },
    coordsys: { color: '#000000', alpha: 1.0, rgba: 'rgba(0, 0, 0, 1.0)', weight: 2, text: 14 }
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
        
        let textInput = '<div class="col-span-2 text-slate-300 text-xs italic text-left pl-1">N/A</div>';
        if (s.text !== undefined) {
             textInput = `<div class="col-span-2 flex items-center gap-1 pl-1">
                                <input type="number" id="style-${key}-text" value="${s.text}" min="8" max="36" class="w-12 border border-slate-600 bg-slate-700 text-white rounded px-1 py-1 text-sm text-center"> px
                            </div>`;
        }

        html += `
            <div class="grid grid-cols-6 gap-2 items-center text-center">
                <div class="text-sm font-medium text-white text-left capitalize overflow-hidden whitespace-nowrap" title="${label}">${label}</div>
                <div class="flex justify-center"><input type="color" id="style-${key}-color" value="${s.color}" class="w-7 h-7 p-0 border-0 rounded cursor-pointer"></div>
                <div><input type="number" id="style-${key}-alpha" value="${s.alpha}" min="0" max="1" step="0.1" class="w-full border border-slate-600 bg-slate-700 text-white rounded px-1 py-1 text-sm text-center"></div>
                <div><input type="number" id="style-${key}-weight" value="${s.weight}" min="1" max="10" class="w-full border border-slate-600 bg-slate-700 text-white rounded px-1 py-1 text-sm text-center"></div>
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

    const gridSizeEl = document.getElementById('setting-grid-size');
    if (gridSizeEl) {
        gridSizeEl.value = state.gridSize;
        gridSizeEl.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val > 0) {
                state.gridSize = val;
                updatePropertyPanel();
                requestRedraw();
            }
        });
    }

    const sysScaleEl = document.getElementById('setting-symbol-scale');
    if (sysScaleEl) {
        sysScaleEl.value = state.symbolScale;
        sysScaleEl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0) {
                state.symbolScale = val;
                requestRedraw();
            }
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
        let bestTarget = null;
        let bestDist = Infinity;
        let bestAxis = null;

        const checkTrackLine = (vx, vy, axisId) => {
            const pvx = pt.x - snapMode.trackRef.x;
            const pvy = pt.y - snapMode.trackRef.y;
            const t = pvx * vx + pvy * vy;
            const px = snapMode.trackRef.x + t * vx;
            const py = snapMode.trackRef.y + t * vy;
            const d = Math.hypot(pt.x - px, pt.y - py);
            
            if (d < snapRadius / state.vw.z && d < bestDist) {
                bestDist = d;
                bestAxis = axisId === 'x' ? 'x' : (axisId === 'y' ? 'y' : { vx, vy });
                
                let snapped = { x: px, y: py };
                if (renderSettings.grid) {
                    if (axisId === 'x') snapped.x = Math.round(snapped.x / state.gridSize) * state.gridSize;
                    else if (axisId === 'y') snapped.y = Math.round(snapped.y / state.gridSize) * state.gridSize;
                    else {
                        const roundedT = Math.round(t / state.gridSize) * state.gridSize;
                        snapped.x = snapMode.trackRef.x + roundedT * vx;
                        snapped.y = snapMode.trackRef.y + roundedT * vy;
                    }
                }
                bestTarget = snapped;
            }
        };

        checkTrackLine(1, 0, 'x');
        checkTrackLine(0, 1, 'y');
        
        for (const ent of state.entities) {
            if (ent.type === 'beam') {
                const len = dist(ent.p1, ent.p2);
                if (len < 1e-3) continue;
                if (dist(ent.p1, snapMode.trackRef) < 1e-3) {
                    checkTrackLine((ent.p2.x - ent.p1.x)/len, (ent.p2.y - ent.p1.y)/len, 'custom');
                } else if (dist(ent.p2, snapMode.trackRef) < 1e-3) {
                    checkTrackLine((ent.p1.x - ent.p2.x)/len, (ent.p1.y - ent.p2.y)/len, 'custom');
                }
            }
        }
        
        if (bestTarget) {
            snapMode.trackAxis = bestAxis;
            return bestTarget;
        }
    }

    // 2. Try Elements (Beams)
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
    
    
    const size = options.size || 12;
    const font = options.font || 'sans-serif';
    const boldStr = options.bold === false ? '' : (options.bold || true ? 'bold ' : 'bold '); // default bold backwards compatible? Actually let's make it respect what is passed. But existing caller assumes bold by default. Let's say if options.bold is provided, use it, else bold.
    const fontWeight = options.bold !== undefined ? (options.bold ? 'bold ' : '') : 'bold ';
    ctx.font = `${fontWeight}${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.fillText(`${text}`, x + 8, y - 8);
    const tw = ctx.measureText(`${text}`).width;
    ctx.restore();
    // World-space bounds of the drawn text, used for label drag hit-testing
    return { x: x + 6, y: y - 8 - size, w: tw + 4, h: size + 6 };
}

// Entity rendering and logic functions
const EntityLogic = {
    arrayload: {
        draw: (ctx, ent, isSelected, isPreview) => {
            const count = state.arrayLoadCount || 5;
            const dx = (ent.p2.x - ent.p1.x);
            const dy = (ent.p2.y - ent.p1.y);
            
            for (let i = 0; i < count; i++) {
                const px = ent.p1.x + dx * i;
                const py = ent.p1.y + dy * i;
                
                ctx.save();
                const headlen = 15 * (state.symbolScale || 1.0);
                const angle = Math.PI / 2;
                const length = 40 * (state.symbolScale || 1.0);
                
                ctx.beginPath();
                ctx.moveTo(px, py - length);
                ctx.lineTo(px, py);
                ctx.lineTo(px - headlen * Math.cos(angle - Math.PI / 6), py - headlen * Math.sin(angle - Math.PI / 6));
                ctx.moveTo(px, py);
                ctx.lineTo(px - headlen * Math.cos(angle + Math.PI / 6), py - headlen * Math.sin(angle + Math.PI / 6));
                
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = '#fca5a5';
                ctx.lineWidth = styleSettings['force'].weight;
                ctx.stroke();
                ctx.restore();
            }
        },
        hitTest: () => false,
        move: () => {}
    },
    coordsys: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const pt = ent.p1;
            const csScale = (ent.csScale || 1.0) * (state.symbolScale || 1.0);
            const size = 50 * csScale; // Size of the axes
            const headlen = 10 * csScale;
            
            ctx.translate(pt.x, pt.y);
            if (ent.angle) {
                ctx.rotate(ent.angle);
            }
            ctx.translate(-pt.x, -pt.y);

            ctx.strokeStyle = isSelected ? '#3b82f6' : (ent.color || styleSettings[ent.type].rgba);
            ctx.lineWidth = isSelected ? (ent.weight || styleSettings[ent.type].weight) + 1 : (ent.weight || styleSettings[ent.type].weight);
            if (isPreview) {
                ctx.strokeStyle = '#94a3b8';
                ctx.setLineDash([4, 4]);
            }

            const signX = ent.flipX ? -1 : 1;
            const signY = ent.flipY ? -1 : 1;

            // Y-axis (pointing up in visual terms when un-flipped) and X-axis, as one path through the origin
            const endY = pt.y - (size * signY);
            const endX = pt.x + (size * signX);
            ctx.beginPath();
            ctx.moveTo(pt.x, endY);
            ctx.lineTo(pt.x, pt.y);
            ctx.lineTo(endX, pt.y);
            ctx.stroke();

            // Arrow heads as symmetric strokes (wing -> tip -> wing) with round joins, so thick axes
            // don't get a lopsided miter spike at the tips
            ctx.setLineDash([]);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            // Y Arrow head
            ctx.moveTo(pt.x - headlen * Math.cos(Math.PI / 3), endY + signY * headlen * Math.sin(Math.PI / 3));
            ctx.lineTo(pt.x, endY);
            ctx.lineTo(pt.x + headlen * Math.cos(Math.PI / 3), endY + signY * headlen * Math.sin(Math.PI / 3));
            // X Arrow head
            ctx.moveTo(endX - signX * headlen * Math.cos(Math.PI / 6), pt.y - headlen * Math.sin(Math.PI / 6));
            ctx.lineTo(endX, pt.y);
            ctx.lineTo(endX - signX * headlen * Math.cos(Math.PI / 6), pt.y + headlen * Math.sin(Math.PI / 6));
            ctx.stroke();

            // Text
            const xText = ent.xLabel || 'x';
            const yText = ent.yLabel || 'y';
            const textSize = (ent.textSize || styleSettings[ent.type].text) * (ent.csScale || 1.0);
            ctx.font = `italic ${textSize}px sans-serif`;
            ctx.fillStyle = ctx.strokeStyle;
            
            // Draw x text
            ctx.textAlign = signX > 0 ? 'left' : 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(xText, endX + (signX * 5 * (ent.csScale || 1.0)), pt.y);
            
            // Draw y text
            ctx.textAlign = 'center';
            ctx.textBaseline = signY > 0 ? 'bottom' : 'top';
            ctx.fillText(yText, pt.x, endY - (signY * 5 * (ent.csScale || 1.0)));

            ctx.restore();
        },
        hitTest: (pt, ent) => {
            const d = dist(pt, ent.p1);
            return d < Math.max(40 / state.vw.z, 50 * (ent.csScale || 1.0) * (state.symbolScale || 1.0) * 0.8);
        },
        move: (ent, dx, dy) => { ent.p1.x += dx; ent.p1.y += dy; }
    },
    arrow: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const headlen = 15 * (ent.arrowScale || 1.0) * (state.symbolScale || 1.0);
            const angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
            
            ctx.strokeStyle = isSelected ? '#3b82f6' : (ent.color || '#000000');
            ctx.lineWidth = isSelected ? (ent.weight || 2) + 1 : (ent.weight || 2);

            if (ent.dashed) {
                ctx.setLineDash([6, 6]);
            }
            if (isPreview) {
                ctx.strokeStyle = '#94a3b8';
                ctx.setLineDash([4, 4]);
            }

            const cosA = Math.cos(angle), sinA = Math.sin(angle);

            // Shaft - with filled heads it stops at each head's base so a thick shaft can't poke out beside the tip
            const shaftLen = Math.hypot(ent.p2.x - ent.p1.x, ent.p2.y - ent.p1.y);
            const nHeads = ent.doubleHead ? 2 : 1;
            const cut = ent.filledHead ? Math.min(headlen * Math.cos(Math.PI / 6), shaftLen / nHeads) : 0;
            const cutStart = ent.doubleHead ? cut : 0;
            ctx.beginPath();
            ctx.moveTo(ent.p1.x + cutStart * cosA, ent.p1.y + cutStart * sinA);
            ctx.lineTo(ent.p2.x - cut * cosA, ent.p2.y - cut * sinA);
            ctx.stroke();

            // Draws one head with its tip at `tip`, pointing in direction `dir`
            const drawHead = (tip, dir) => {
                const wing1 = { x: tip.x - headlen * Math.cos(dir - Math.PI / 6), y: tip.y - headlen * Math.sin(dir - Math.PI / 6) };
                const wing2 = { x: tip.x - headlen * Math.cos(dir + Math.PI / 6), y: tip.y - headlen * Math.sin(dir + Math.PI / 6) };
                ctx.beginPath();
                if (ent.filledHead) {
                    // Filled triangle head
                    ctx.moveTo(tip.x, tip.y);
                    ctx.lineTo(wing1.x, wing1.y);
                    ctx.lineTo(wing2.x, wing2.y);
                    ctx.closePath();
                    ctx.fill();
                } else {
                    // Head as one symmetric stroke (wing -> tip -> wing) with round joins, so thick arrows
                    // don't get a lopsided miter spike at the tip
                    ctx.moveTo(wing1.x, wing1.y);
                    ctx.lineTo(tip.x, tip.y);
                    ctx.lineTo(wing2.x, wing2.y);
                    ctx.stroke();
                }
            };

            ctx.setLineDash([]);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.fillStyle = ctx.strokeStyle;
            drawHead(ent.p2, angle);
            if (ent.doubleHead) drawHead(ent.p1, angle + Math.PI);
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
            // Without end dots, round caps keep joints between beams (e.g. frame corners) closed
            if (ent.hideEndDots) ctx.lineCap = 'round';
            ctx.stroke();

            if (!ent.hideEndDots) {
                ctx.beginPath(); ctx.arc(ent.p1.x, ent.p1.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
                ctx.beginPath(); ctx.arc(ent.p2.x, ent.p2.y, 3, 0, Math.PI*2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
            }
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
    force: {
        draw: (ctx, ent, isSelected, isPreview) => {
            ctx.save();
            const headlen = 15 * (state.symbolScale || 1.0);
            const angle = Math.atan2(ent.p2.y - ent.p1.y, ent.p2.x - ent.p1.x);
            
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            ctx.lineTo(ent.p2.x - headlen * Math.cos(angle - Math.PI / 6), ent.p2.y - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(ent.p2.x, ent.p2.y);
            ctx.lineTo(ent.p2.x - headlen * Math.cos(angle + Math.PI / 6), ent.p2.y - headlen * Math.sin(angle + Math.PI / 6));
            
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
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
                const ox = ent.textOffset ? ent.textOffset.x : 0;
                const oy = ent.textOffset ? ent.textOffset.y : 0;
                ent._labelBounds = drawTextMagnitude(ctx, textStr, isSelected ? '#3b82f6' : (ent.textColor || styleSettings[ent.type].rgba), ent.p1.x + ox, ent.p1.y + oy, {
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
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
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
                let nx, ny;
                if (ent.projectDownwards) {
                    nx = 0;
                    ny = 1;
                } else {
                    nx = -dy / len;
                    ny = dx / len;
                }
                
                let rawStart = ent.startMagnitude !== undefined ? ent.startMagnitude : (ent.magnitude || '10');
                let rawEnd = ent.endMagnitude !== undefined ? ent.endMagnitude : (ent.magnitude || '10');
                
                let mStart = parseFloat(rawStart);
                let mEnd = parseFloat(rawEnd);
                
                if (isNaN(mStart)) mStart = String(rawStart).trim().startsWith('-') ? -10 : 10;
                if (isNaN(mEnd)) mEnd = String(rawEnd).trim().startsWith('-') ? -10 : 10;

                const maxMag = Math.max(Math.abs(mStart), Math.abs(mEnd), 1);
                
                const baseHeight = (ent.loadHeight !== undefined ? ent.loadHeight : 25) * (state.symbolScale || 1.0);
                const hStart = baseHeight * (mStart / maxMag);
                const hEnd = baseHeight * (mEnd / maxMag);
                
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
                    const sDir = h >= 0 ? 1 : -1;
                    ctx.beginPath();
                    ctx.moveTo(px, py);
                    ctx.lineTo(px - nx * al * sDir + ny * aw, py - ny * al * sDir - nx * aw);
                    ctx.moveTo(px, py);
                    ctx.lineTo(px - nx * al * sDir - ny * aw, py - ny * al * sDir + nx * aw);
                    ctx.stroke();
                }

                // Text
                if (ent.showMagnitude !== false) {
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
                    
                    const ox = ent.textOffset ? ent.textOffset.x : 0;
                    const oy = ent.textOffset ? ent.textOffset.y : 0;
                    const tcx = midX - nx * (midH + 8) + ox;
                    const tcy = midY - ny * (midH + 8) + oy;
                    ctx.translate(tcx, tcy);
                    let angle;
                    if (ent.projectDownwards) {
                        angle = 0;
                    } else {
                        angle = Math.atan2(dy, dx);
                        if (Math.abs(angle) > Math.PI/2) angle += Math.PI;
                    }
                    ctx.rotate(angle);
                    ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.textAlign = 'center';
                    ctx.fillText(textStr, 0, 0);
                    const tw = ctx.measureText(textStr).width;
                    ent._labelBounds = { x: tcx - tw / 2 - 4, y: tcy - 14, w: tw + 8, h: 22 };
                } else {
                    ent._labelBounds = null;
                }
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
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
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

            const mox = ent.textOffset ? ent.textOffset.x : 0;
            const moy = ent.textOffset ? ent.textOffset.y : 0;
            ent._labelBounds = drawTextMagnitude(ctx, ent.magnitude, isSelected ? '#3b82f6' : styleSettings[ent.type].rgba, ent.p1.x + 25 + mox, ent.p1.y - 25 + moy, { size: styleSettings[ent.type].text });
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
                const extOvershoot = 6 * (state.symbolScale || 1.0);
                const extOffset = offset + (offset >= 0 ? extOvershoot : -extOvershoot);
                const gap = 4 * (state.symbolScale || 1.0);
                const dirX = offset >= 0 ? 1 : -1;
                
                // If short lines, the extension only goes down a small amount rather than all the way to p1/p2
                const shortLen = (ent.dimShortLength !== undefined ? ent.dimShortLength : 12) * (state.symbolScale || 1.0);
                const startOff1 = ent.dimShortLines ? offset - (offset >= 0 ? shortLen : -shortLen) : gap * dirX;
                const startOff2 = ent.dimShortLines ? offset - (offset >= 0 ? shortLen : -shortLen) : gap * dirX;

                ctx.beginPath();
                ctx.moveTo(ent.p1.x + nx * startOff1, ent.p1.y + ny * startOff1);
                ctx.lineTo(ent.p1.x + nx * extOffset, ent.p1.y + ny * extOffset);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(ent.p2.x + nx * startOff2, ent.p2.y + ny * startOff2);
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
            const headlen = 12 * (state.symbolScale || 1.0);
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
                    const shortLen = ent.dimShortLength !== undefined ? ent.dimShortLength : 12;

                    ctx.beginPath();
                    // First line
                    if (ent.dimShortLines) {
                        ctx.moveTo(ent.p1.x + Math.cos(a1)*(radius-shortLen), ent.p1.y + Math.sin(a1)*(radius-shortLen));
                    } else {
                        ctx.moveTo(ent.p1.x, ent.p1.y);
                    }
                    ctx.lineTo(ent.p1.x + Math.cos(a1)*(radius+10), ent.p1.y + Math.sin(a1)*(radius+10));
                    
                    // Second line
                    if (ent.dimShortLines) {
                        ctx.moveTo(ent.p1.x + Math.cos(a2)*(radius-shortLen), ent.p1.y + Math.sin(a2)*(radius-shortLen));
                    } else {
                        ctx.moveTo(ent.p1.x, ent.p1.y);
                    }
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
            // Head length grows with the line weight so thick dimensions don't swallow their arrows
            const dimWeight = styleSettings[ent.type].weight || 1;
            const headlen = 10 * (state.symbolScale || 1.0) * (1 + 0.4 * Math.max(0, dimWeight - 1));
            const hAngle = Math.PI / 8;

            // Heads as symmetric strokes (wing -> tip -> wing) with round joins, so thick lines
            // don't get a lopsided miter spike at the tip
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            const t1Start = startA + Math.PI/2;
            ctx.beginPath();
            const px1 = ent.p1.x + radius*Math.cos(startA);
            const py1 = ent.p1.y + radius*Math.sin(startA);
            ctx.moveTo(px1 + headlen * Math.cos(t1Start - hAngle), py1 + headlen * Math.sin(t1Start - hAngle));
            ctx.lineTo(px1, py1);
            ctx.lineTo(px1 + headlen * Math.cos(t1Start + hAngle), py1 + headlen * Math.sin(t1Start + hAngle));
            ctx.stroke();

            const t2End = endA - Math.PI/2;
            ctx.beginPath();
            const px2 = ent.p1.x + radius*Math.cos(endA);
            const py2 = ent.p1.y + radius*Math.sin(endA);
            ctx.moveTo(px2 + headlen * Math.cos(t2End - hAngle), py2 + headlen * Math.sin(t2End - hAngle));
            ctx.lineTo(px2, py2);
            ctx.lineTo(px2 + headlen * Math.cos(t2End + hAngle), py2 + headlen * Math.sin(t2End + hAngle));
            ctx.stroke();

            // Text
            const angleDeg = (angleDiff * 180 / Math.PI);
            let textStr = "";
            if (ent.dimText && ent.dimText.trim() !== '') {
                textStr = ent.dimText;
            } else {
                const dec = ent.dimDecimals !== undefined ? ent.dimDecimals : (ent.dimRadians ? 2 : 1);
                const val = ent.dimRadians ? angleDiff : angleDeg;
                const unitMark = ent.dimRadians ? " rad" : "°";
                textStr = val.toFixed(dec) + (ent.dimUnits !== false ? unitMark : "");
            }
            
            ctx.font = `${styleSettings[ent.type].text}px sans-serif`;
            const textWidth = ctx.measureText(textStr).width + 8;
            const th = 16;
            
            const midA = startA + (endA - startA) / 2;
            // textOffset lets the user drag the label away from its default spot (like load labels)
            const tox = ent.textOffset ? ent.textOffset.x : 0;
            const toy = ent.textOffset ? ent.textOffset.y : 0;
            const tmX = ent.p1.x + (radius + 20) * Math.cos(midA) + tox;
            const tmY = ent.p1.y + (radius + 20) * Math.sin(midA) + toy;

            ctx.save();
            ctx.translate(tmX, tmY);

            let rotA = midA + Math.PI/2;
            if (rotA > Math.PI/2 && rotA < Math.PI*3/2) rotA -= Math.PI;
            ctx.rotate(rotA);

            // Axis-aligned bounds of the rotated label box, used to grab and drag the label
            if (!isPreview) {
                const bw = Math.abs(textWidth * Math.cos(rotA)) + Math.abs(th * Math.sin(rotA));
                const bh = Math.abs(textWidth * Math.sin(rotA)) + Math.abs(th * Math.cos(rotA));
                ent._labelBounds = { x: tmX - bw / 2, y: tmY - bh / 2, w: bw, h: bh };
            }
            
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
            const t = 12;
            const r = 4;
            // Draw triangle
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-t, t*1.5); ctx.lineTo(t, t*1.5); ctx.closePath(); ctx.stroke();
            // Draw two rollers
            ctx.beginPath(); ctx.arc(-t/2, t*1.5 + r, r, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(t/2, t*1.5 + r, r, 0, Math.PI * 2); ctx.stroke();
            // Draw baseline
            ctx.beginPath(); ctx.moveTo(-t*1.5, t*1.5 + 2*r); ctx.lineTo(t*1.5, t*1.5 + 2*r); ctx.stroke();
            // Draw hatching
            drawHatching(ctx, 0, t*1.5 + 2*r, t*3);
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
    slider: {
        draw: (ctx, ent, isSelected) => {
            ctx.save();
            let ang = ent.angle || 0;
            const beam = state.entities.find(e => e.type === 'beam' && distToLine(ent.p1, e.p1, e.p2) < 1e-3);
            if (beam) ang = Math.atan2(beam.p2.y - beam.p1.y, beam.p2.x - beam.p1.x);

            ctx.translate(ent.p1.x, ent.p1.y);
            ctx.rotate(ang);
            ctx.scale(state.symbolScale, state.symbolScale);

            ctx.fillStyle = ctx.strokeStyle = isSelected ? '#3b82f6' : styleSettings[ent.type].rgba;
            ctx.lineWidth = styleSettings[ent.type].weight;
            
            const r = 4;
            const w = 12;
            const gap = 6;
            
            ctx.beginPath(); ctx.arc(-w/2, -gap, r, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(w/2, -gap, r, 0, Math.PI * 2); ctx.stroke();
            
            ctx.beginPath(); ctx.arc(-w/2, gap, r, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(w/2, gap, r, 0, Math.PI * 2); ctx.stroke();
            
            ctx.beginPath(); ctx.moveTo(-w, -gap-r); ctx.lineTo(w, -gap-r); ctx.stroke();
            ctx.save(); ctx.translate(0, -gap-r); ctx.scale(1, -1); drawHatching(ctx, 0, 0, w*2+4); ctx.restore();
            
            ctx.beginPath(); ctx.moveTo(-w, gap+r); ctx.lineTo(w, gap+r); ctx.stroke();
            drawHatching(ctx, 0, gap+r, w*2+4);
            
            ctx.restore();
        },
        hitTest: (pt, ent) => dist(pt, ent.p1) < 15 / state.vw.z,
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
    },
    image: {
        draw: (ctx, ent, isSelected, isPreview) => {
            if (!ent.img && ent.dataUrl) {
                ent.img = new Image();
                ent.img.src = ent.dataUrl;
                ent.img.onload = () => { if (typeof requestRedraw === 'function') requestRedraw(); };
            }
            if (ent.img && ent.img.complete) {
                ctx.save();
                ctx.translate(ent.p1.x, ent.p1.y);
                ctx.globalAlpha = ent.opacity || 0.4; // 40% initial opacity is good for tracing
                
                let w = ent.img.width;
                let h = ent.img.height;
                if (ent.p2) {
                    w = ent.p2.x - ent.p1.x;
                    h = ent.p2.y - ent.p1.y;
                }
                
                ctx.drawImage(ent.img, 0, 0, w, h);
                
                if (isSelected) {
                    ctx.globalAlpha = 1.0;
                    ctx.strokeStyle = '#3b82f6';
                    ctx.setLineDash([5 / state.vw.z, 5 / state.vw.z]);
                    ctx.lineWidth = 2 / state.vw.z;
                    ctx.strokeRect(0, 0, w, h);
                }
                ctx.restore();
            }
        },
        hitTest: (pt, ent) => {
            if (!ent.p2) return false;
            const minX = Math.min(ent.p1.x, ent.p2.x);
            const maxX = Math.max(ent.p1.x, ent.p2.x);
            const minY = Math.min(ent.p1.y, ent.p2.y);
            const maxY = Math.max(ent.p1.y, ent.p2.y);
            return (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY);
        },
        move: (ent, dx, dy) => { 
            ent.p1.x += dx; ent.p1.y += dy; 
            if (ent.p2) { ent.p2.x += dx; ent.p2.y += dy; }
        }
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

let lastBgStr = '';

function updateGridBackground() {
    // Only update expensive string assignments if they actually change
    const newBgColor = styleSettings.bgColor;
    if (wrapper.style.backgroundColor !== newBgColor) {
        wrapper.style.backgroundColor = newBgColor;
    }

    if (styleSettings.showGrid) {
        const bgImg = 'linear-gradient(to right, rgba(203, 213, 225, 0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(203, 213, 225, 0.4) 1px, transparent 1px)';
        if (wrapper.style.backgroundImage !== bgImg) {
            wrapper.style.backgroundImage = bgImg;
        }
        const bgSize = state.gridSize * state.vw.z;
        wrapper.style.backgroundSize = `${bgSize}px ${bgSize}px`;
        wrapper.style.backgroundPosition = `${state.vw.x}px ${state.vw.y}px`;
    } else {
        if (wrapper.style.backgroundImage !== 'none') {
            wrapper.style.backgroundImage = 'none';
        }
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

let visibilityCache = null;

function isEntityVisible(ent) {
    if (!ent) return true;
    
    // Cache the DOM reads once per render frame
    if (!visibilityCache) {
        visibilityCache = {
            structure: document.getElementById('vis-structure')?.checked ?? true,
            supports: document.getElementById('vis-supports')?.checked ?? true,
            loads: document.getElementById('vis-loads')?.checked ?? true,
            dimensions: document.getElementById('vis-dimensions')?.checked ?? true,
            annotations: document.getElementById('vis-annotations')?.checked ?? true
        };
    }

    const type = ent.type;
    if (type === 'beam') return visibilityCache.structure;
    if (['pin', 'roller', 'fixed', 'slider', 'hinge', 'spring', 'rotspr'].includes(type)) return visibilityCache.supports;
    if (['force', 'distload', 'moment'].includes(type)) return visibilityCache.loads;
    if (['dimension', 'angdim'].includes(type)) return visibilityCache.dimensions;
    if (['line', 'arrow', 'textLabel', 'coordsys', 'image'].includes(type)) return visibilityCache.annotations;
    
    return true; // fallback
}

function render() {
    visibilityCache = null; // reset cache for the new frame
    const cWidth = wrapper.clientWidth;
    const cHeight = wrapper.clientHeight;
    ctx.clearRect(0, 0, cWidth, cHeight);
    updateGridBackground();

    ctx.save();
    ctx.translate(state.vw.x, state.vw.y);
    ctx.scale(state.vw.z, state.vw.z);

    // Draw global Origin X/Y Axes lightly
    if (state.showAxes !== false) {
        ctx.beginPath();
        ctx.moveTo(-100000, 0); ctx.lineTo(100000, 0);
        ctx.moveTo(0, -100000); ctx.lineTo(0, 100000);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)'; // Slate-400 with opacity
        ctx.lineWidth = 1 / state.vw.z;
        ctx.stroke();
    }

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

    // Draw calibration line
    if (state.tool === 'calibrate' && state.calibratePoints && state.calibratePoints.length === 1) {
        ctx.beginPath();
        const cp = state.calibratePoints[0];
        ctx.moveTo(cp.x, cp.y);
        ctx.lineTo(state.cursorPt.x, state.cursorPt.y);
        ctx.strokeStyle = '#ef4444'; 
        ctx.lineWidth = 2 / state.vw.z;
        ctx.setLineDash([5 / state.vw.z, 5 / state.vw.z]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw FE Diagram overlays
    if (state.feResults && state.feResults.success && state.activeDiagram && typeof drawFEDiagrams === 'function') {
        drawFEDiagrams(ctx, state.feResults, state.activeDiagram, state.diagramScale, state.mouseWorldPos, state);
    }

    ctx.globalAlpha = 1.0;

    // Draw Ortho Tracking Line Guide
    if (snapMode.trackRef && snapMode.trackAxis && ['influence', 'force', 'moment', 'distload', 'pin', 'roller', 'fixed', 'slider', 'hinge', 'spring', 'rotspr', 'beam', 'dimension', 'chaindim'].includes(state.tool) && !state.isMovingEntity) {
        ctx.save();
        
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

    ctx.restore();

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

function showMultiPickMenu(entities, x, y, callback) {
    const existing = document.getElementById('multipick-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.id = 'multipick-menu';
    menu.className = 'absolute bg-white border border-slate-300 rounded shadow-xl z-50 text-sm overflow-hidden min-w-[120px]';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    const header = document.createElement('div');
    header.className = 'bg-slate-50 px-3 py-1.5 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-default';
    header.innerText = 'Select Element';
    menu.appendChild(header);
    
    entities.forEach(ent => {
        const item = document.createElement('div');
        item.className = 'px-3 py-2 cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition flex items-center justify-between border-b border-slate-100 last:border-0';
        
        let label = ent.type.charAt(0).toUpperCase() + ent.type.slice(1);
        if (ent.type === 'beam') label = 'Beam';
        else if (ent.type === 'distload') label = 'Dist. Load';
        else if (ent.type === 'rotspr') label = 'Rot. Spring';
        
        const textSpan = document.createElement('span');
        textSpan.className = 'font-medium';
        textSpan.innerText = label;
        item.appendChild(textSpan);
        
        const idSpan = document.createElement('span');
        idSpan.className = 'text-xs text-slate-300 ml-3';
        idSpan.innerText = `id: ${ent.id}`;
        item.appendChild(idSpan);
        
        // Let it handle clicks natively
        item.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.remove();
            document.removeEventListener('mousedown', closeListener, true);
            // Defer so the menu removal repaints before any blocking prompt() in the callback
            setTimeout(() => callback(ent), 0);
        });
        
        // Highlight entity on hover
        item.addEventListener('mouseenter', () => {
            // Draw a quick bounding box or highlight over it
            // Simple way is to just briefly add it to a temporary hover list but easiest is just let canvas be
        });
        
        menu.appendChild(item);
    });
    
    document.body.appendChild(menu);
    
    // Auto-close if clicked elsewhere
    const closeListener = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('mousedown', closeListener, true);
        }
    };
    
    document.addEventListener('mousedown', closeListener, true);
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

    if (state.tool === 'calibrate') {
        state.calibratePoints = state.calibratePoints || [];
        state.calibratePoints.push(wPt);
        if (state.calibratePoints.length === 2) {
            const p1 = state.calibratePoints[0];
            const p2 = state.calibratePoints[1];
            const dCanvas = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const distStr = prompt('Enter the known physical distance between these two points (in meters):');
            if (distStr !== null) {
                const dReal = parseFloat(distStr.replace(',', '.'));
                if (!isNaN(dReal) && dReal > 0 && dCanvas > 0) {
                    // Convert dReal (meters) into world space units by multiplying with state.gridSize
                    const scaleFactor = (dReal * state.gridSize) / dCanvas;
                    const ent = state.entities.find(en => en.id === state.calibratingEntityId);
                    if (ent && ent.type === 'image') {
                        saveState();
                        const w = ent.p2.x - ent.p1.x;
                        const h = ent.p2.y - ent.p1.y;
                        
                        // Anchor scaling on the first clicked point (p1)
                        const dx = p1.x - ent.p1.x;
                        const dy = p1.y - ent.p1.y;
                        
                        ent.p1.x = p1.x - dx * scaleFactor;
                        ent.p1.y = p1.y - dy * scaleFactor;
                        
                        ent.p2.x = ent.p1.x + w * scaleFactor;
                        ent.p2.y = ent.p1.y + h * scaleFactor;
                    }
                } else {
                    alert('Invalid distance. Calibration cancelled.');
                }
            }
            state.tool = 'select';
            state.calibratePoints = [];
            state.calibratingEntityId = null;
            wrapper.style.cursor = 'default';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
            const selectBtn = document.getElementById('tool-select');
            if (selectBtn) selectBtn.classList.add('active-tool');
        }
        requestRedraw();
        return;
    }

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

        // Drag a value label (force / moment / distload text, angular dimension text)
        for (let i = state.entities.length - 1; i >= 0; i--) {
            const ent = state.entities[i];
            const lb = ent._labelBounds;
            if (lb && ['force', 'moment', 'distload', 'angdim'].includes(ent.type) &&
                wPt.x >= lb.x && wPt.x <= lb.x + lb.w && wPt.y >= lb.y && wPt.y <= lb.y + lb.h) {
                saveState();
                state.isDraggingLabel = ent.id;
                state.labelDragStart = { x: wPt.x, y: wPt.y, ox: ent.textOffset ? ent.textOffset.x : 0, oy: ent.textOffset ? ent.textOffset.y : 0 };
                return;
            }
        }

        let hitEntities = [];
        for (let i = state.entities.length - 1; i >= 0; i--) {
            if (EntityLogic[state.entities[i].type].hitTest(wPt, state.entities[i])) {
                hitEntities.push(state.entities[i]);
            }
        }
        
        const applySelection = (clicked, startMove = true) => {
            let idsToAdd = [clicked.id];
            if (clicked.groupId) {
                idsToAdd = state.entities.filter(e => e.groupId === clicked.groupId).map(e => e.id);
            }

            if (e.ctrlKey) {
                if (state.selectedIds.includes(clicked.id)) {
                    state.selectedIds = state.selectedIds.filter(id => !idsToAdd.includes(id));
                } else {
                    idsToAdd.forEach(id => {
                        if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
                    });
                }
            } else {
                if (!state.selectedIds.includes(clicked.id)) {
                    state.selectedIds = [...idsToAdd];
                } else {
                    idsToAdd.forEach(id => {
                        if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
                    });
                }
            }
            state.selectedEntityId = state.selectedIds.length > 0 ? state.selectedIds[state.selectedIds.length - 1] : null;
            
            if (startMove) {
                state.isMovingEntity = true;
                // Temporarily ignore the moving entity in snap to avoid self-snapping loops while dragging
                let sPt = snap(wPt);
                state.startX = sPt.x;
                state.startY = sPt.y;
                saveState();
            }
            
            updatePropertyPanel();
            requestRedraw();
        };

        const clickedAlreadySelected = hitEntities.find(ent => state.selectedIds.includes(ent.id));

        if (clickedAlreadySelected && !e.ctrlKey) {
            // Prioritize dragging the current selection instead of prompting multi-pick if there are overlapping entities
            applySelection(clickedAlreadySelected, true);
        } else if (hitEntities.length === 1) {
            applySelection(hitEntities[0], true);
        } else if (hitEntities.length > 1) {
            showMultiPickMenu(hitEntities, e.clientX, e.clientY, (clicked) => applySelection(clicked, false));
            return; // skip requestRedraw/updatePropertyPanel
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
        let hitEntities = [];
        for (let i = state.entities.length - 1; i >= 0; i--) {
            if (EntityLogic[state.entities[i].type].hitTest(wPt, state.entities[i])) {
                hitEntities.push(state.entities[i]);
            }
        }
        
        // Ask which direction the moving unit load acts in: global vertical or perpendicular to the member it travels on
        const askInfluenceLoadDir = () => {
            const dir = prompt("Moving unit load direction:\nV = Global vertical (downwards)\nP = Perpendicular to the member", "V");
            if (!dir) return null;
            return dir.trim().toLowerCase().startsWith('p') ? 'perpendicular' : 'vertical';
        };

        const handleInfluencePick = (clicked) => {
            const supportTypes = ['pin', 'roller', 'fixed', 'slider', 'hinge', 'spring', 'rotspr'];
            if (supportTypes.includes(clicked.type)) {
                const component = prompt("Influence Line target: Support.\nWhich force component to track? (Type: Rx, Ry, or Mz)", "Ry");
                if (!component) return;
                const loadDir = askInfluenceLoadDir();
                if (loadDir) runInfluenceLine(clicked, 'reaction', component.toLowerCase(), null, loadDir);
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
                if (!component) return;
                const loadDir = askInfluenceLoadDir();
                if (loadDir) runInfluenceLine(clicked, 'internal', component.toLowerCase(), ratio, loadDir);
            } else {
                alert("Please click on a Support or a Beam to target an influence line.");
            }
        };

        if (hitEntities.length === 1) {
            handleInfluencePick(hitEntities[0]);
        } else if (hitEntities.length > 1) {
            // Optional: filter out valid targets to avoid clicking through loads? 
            // We can just show all of them for consistency.
            showMultiPickMenu(hitEntities, e.clientX, e.clientY, handleInfluencePick);
        }
        return;
    }

    // Multi-click tools
    if (['beam', 'distload', 'dimension', 'chaindim', 'angdim', 'line', 'arrow', 'arrayload'].includes(state.tool)) {
        if (state.drawingStep === 0) {
            saveState();
            state.drawingStep = 1;
            state.tempEntity = {
                id: generateId(),
                type: state.tool === 'chaindim' ? 'dimension' : state.tool,
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
            
            if (['beam', 'distload', 'dimension', 'arrayload'].includes(state.tool)) {
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
                if (['dimension', 'chaindim', 'angdim'].includes(state.tool)) {
                    state.drawingStep = 2;
                    state.tempEntity.p3 = wPt;
                } else {
                    if (state.tool === 'arrayload') {
                        const pt1 = state.tempEntity.p1;
                        const pt2 = state.tempEntity.p2;
                        const count = state.arrayLoadCount || 5;
                        const dx = (pt2.x - pt1.x);
                        const dy = (pt2.y - pt1.y);
                        const groupId = 'group_' + generateId();
                        state.selectedIds = [];
                        for (let i = 0; i < count; i++) {
                            const px = pt1.x + dx * i;
                            const py = pt1.y + dy * i;
                            const visualLen = 40 / state.vw.z;
                            const newForce = {
                                id: generateId(),
                                type: 'force',
                                p2: { x: px, y: py },
                                p1: { x: px, y: py - visualLen },
                                angle: Math.PI / 2,
                                magnitude: '10',
                                groupId: groupId
                            };
                            state.entities.push(newForce);
                            state.selectedIds.push(newForce.id);
                        }
                        state.selectedEntityId = state.selectedIds[state.selectedIds.length - 1];
                    } else {
                        state.entities.push({...state.tempEntity});
                        state.selectedIds = [state.tempEntity.id];
                        state.selectedEntityId = state.tempEntity.id;
                    }
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
        } else if (state.drawingStep === 2 && ['dimension', 'chaindim', 'angdim'].includes(state.tool)) {
            if (state.tool === 'dimension' || state.tool === 'chaindim') {
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
                
                if (state.tool === 'chaindim') {
                    const groupId = 'group_' + generateId();
                    state.tempEntity.groupId = groupId;
                    
                    const dx = state.tempEntity.p2.x - state.tempEntity.p1.x;
                    const dy = state.tempEntity.p2.y - state.tempEntity.p1.y;
                    const len = Math.hypot(dx, dy);
                    let offset = 40;
                    if (len > 0) {
                        const nx = -dy / len;
                        const ny = dx / len;
                        offset = (state.tempEntity.p3.x - state.tempEntity.p1.x) * nx + (state.tempEntity.p3.y - state.tempEntity.p1.y) * ny;
                    }
                    
                    state.chainDimGroupId = groupId;
                    state.chainDimOffset = offset;
                    state.entities.push({...state.tempEntity});
                    
                    state.tempEntity = {
                        id: generateId(),
                        type: 'dimension',
                        p1: {...state.tempEntity.p2},
                        p2: snap(wPt),
                        groupId: groupId
                    };
                    state.drawingStep = 3;
                    requestRedraw();
                    return;
                }
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
        } else if (state.drawingStep === 3 && state.tool === 'chaindim') {
            state.tempEntity.p2 = snap(wPt);
            
            const dx = state.tempEntity.p2.x - state.tempEntity.p1.x;
            const dy = state.tempEntity.p2.y - state.tempEntity.p1.y;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
                const nx = -dy / len;
                const ny = dx / len;
                state.tempEntity.p3 = {
                    x: state.tempEntity.p1.x + state.chainDimOffset * nx,
                    y: state.tempEntity.p1.y + state.chainDimOffset * ny
                };
            }
            
            if (dist(state.tempEntity.p1, state.tempEntity.p2) > 0) {
                state.entities.push({...state.tempEntity});
            }
            
            // Re-initialize for the next potential point
            state.tempEntity = {
                id: generateId(),
                type: 'dimension',
                p1: {...state.tempEntity.p2},
                p2: snap(wPt),
                groupId: state.chainDimGroupId
            };
            // Stay in drawingStep = 3
        }
        requestRedraw();
        return;
    }

    // Single-click tools (Supports, Moments, Text, Force)
    if (['pin', 'roller', 'fixed', 'slider', 'hinge', 'spring', 'rotspr', 'moment', 'textLabel', 'force', 'coordsys'].includes(state.tool)) {
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

    if (state.tool === 'calibrate' && state.calibratePoints && state.calibratePoints.length === 1) {
        requestRedraw();
    }

    if (state.isDraggingLabel) {
        const ent = state.entities.find(en => en.id === state.isDraggingLabel);
        if (ent) {
            ent.textOffset = {
                x: state.labelDragStart.ox + (wPt.x - state.labelDragStart.x),
                y: state.labelDragStart.oy + (wPt.y - state.labelDragStart.y)
            };
            requestRedraw();
        }
        return;
    }

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
        if (['dimension', 'angdim'].includes(state.tempEntity.type)) {
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
    } else if (state.drawingStep === 2 && state.tempEntity && ['dimension', 'angdim'].includes(state.tempEntity.type)) {
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

        requestRedraw();
    } else if (state.drawingStep === 3 && state.tool === 'chaindim' && state.tempEntity) {
        state.tempEntity.p2 = snap(wPt);
        const dx = state.tempEntity.p2.x - state.tempEntity.p1.x;
        const dy = state.tempEntity.p2.y - state.tempEntity.p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
            const nx = -dy / len;
            const ny = dx / len;
            state.tempEntity.p3 = {
                x: state.tempEntity.p1.x + state.chainDimOffset * nx,
                y: state.tempEntity.p1.y + state.chainDimOffset * ny
            };
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
        
        let expandedSelection = [...state.selectedIds];
        state.selectedIds.forEach(id => {
            const ent = state.entities.find(e => e.id === id);
            if (ent && ent.groupId) {
                state.entities.forEach(e => {
                    if (e.groupId === ent.groupId && !expandedSelection.includes(e.id)) {
                        expandedSelection.push(e.id);
                    }
                });
            }
        });
        state.selectedIds = expandedSelection;
        
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
    if (state.isDraggingLabel) {
        state.isDraggingLabel = null;
        state.labelDragStart = null;
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
populateProfileDropdown('prop-section-profile');
resize();
saveState();

// -------- Influence Line Logic --------
function runInfluenceLine(targetEnt, type, component, ratio, loadDir = 'vertical') {
    if (typeof buildFEModel !== 'function' || typeof solveFEModel !== 'function') {
        alert("Solver not built/loaded."); return;
    }
    const STEPS = 1000;
    const influenceData = [];
    const pointsData = [];
    
    // Extract only the physically connected structure for the moving unit load
    const allBeams = state.entities.filter(e => e.type === 'beam');
    const distToSeg = (p, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    let walkableSegments = [];
    let knownPoints = [targetEnt.p1];
    if (targetEnt.p2) knownPoints.push(targetEnt.p2);

    let added;
    do {
        added = false;
        for (let b of allBeams) {
            if (!walkableSegments.includes(b)) {
                // Connected if an endpoint touches a known point, or a known point lies mid-segment (e.g. support under a continuous beam)
                const connected = knownPoints.some(p => distToSeg(p, b.p1, b.p2) < 5);
                if (connected) {
                    walkableSegments.push(b);
                    knownPoints.push(b.p1, b.p2);
                    added = true;
                }
            }
        }
    } while (added);

    if (walkableSegments.length === 0) {
        alert("No beam is connected to the selected target — the unit load has no path to travel on.");
        return;
    }

    let totalLength = 0;
    walkableSegments.forEach(b => {
        b._len = Math.hypot(b.p2.x - b.p1.x, b.p2.y - b.p1.y);
        totalLength += b._len;
    });

    // Sample each member separately (including both of its ends) so every member gets its own
    // diagram run - values can jump at joints (e.g. when the load direction changes at a frame corner)
    const samples = [];
    walkableSegments.forEach((b, segIdx) => {
        if (b._len < 1e-9) return;
        const n = Math.max(2, Math.round(STEPS * b._len / totalLength));
        for (let k = 0; k <= n; k++) {
            const r = k / n;
            samples.push({
                point: { x: b.p1.x + (b.p2.x - b.p1.x) * r, y: b.p1.y + (b.p2.y - b.p1.y) * r },
                seg: b,
                segIdx
            });
        }
    });
    const segIdxData = [];

    for (const { point, seg, segIdx } of samples) {
        segIdxData.push(segIdx);

        // Unit load direction in canvas space (y down). Default: global vertical, pointing down.
        let lx = 0, ly = 1;
        if (loadDir === 'perpendicular' && seg && seg._len > 1e-9) {
            const ux = (seg.p2.x - seg.p1.x) / seg._len;
            const uy = (seg.p2.y - seg.p1.y) / seg._len;
            lx = -uy; ly = ux;
            // Orient the normal so it points downwards (or to the right on vertical members)
            if (ly < -1e-9 || (Math.abs(ly) <= 1e-9 && lx < 0)) { lx = -lx; ly = -ly; }
        }

        const baseEnts = state.entities.filter(e => !['force', 'distload', 'moment'].includes(e.type));
        baseEnts.push({
            id: 'inf-load',
            type: 'force',
            p1: { x: point.x - lx * state.gridSize, y: point.y - ly * state.gridSize }, 
            p2: point, // Force is applied at tip (p2) in this app
            magnitude: 1, 
            unit: '',
            angle: Math.atan2(ly, lx)
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
    
    // Diagram offset direction per member, independent of the direction the member was drawn in:
    // positive values are plotted upwards (or to the left on vertical members)
    const segNormals = walkableSegments.map(b => {
        if (!(b._len > 1e-9)) return { x: 0, y: -1 };
        let nx = -(b.p2.y - b.p1.y) / b._len;
        let ny = (b.p2.x - b.p1.x) / b._len;
        if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)) { nx = -nx; ny = -ny; }
        return { x: nx, y: ny };
    });

    state.activeDiagram = 'influence';
    state.feResults = {
        success: true,
        isInfluence: true,
        influencePoints: pointsData,
        influenceValues: influenceData,
        influenceSegs: segIdxData,
        influenceSegNormals: segNormals,
        infTarget: { type, component, entity: targetEnt, loadDir }
    };
    
    document.getElementById('results-panel').classList.remove('hidden');
    setResultsMode('influence');
    document.querySelectorAll('.diagram-toggle-btn').forEach(b => {
        b.classList.remove('bg-indigo-600', 'text-white');
        if (b.dataset.diagram === 'influence') {
            b.classList.add('bg-indigo-600', 'text-white');
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


// Sidebar Drag to Resize functionality
const sidebarEl = document.getElementById('left-sidebar');
const resizerEl = document.getElementById('sidebar-resizer');
let isResizingSidebar = false;

if (sidebarEl && resizerEl) {
    resizerEl.addEventListener('mousedown', (e) => {
        isResizingSidebar = true;
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizingSidebar) return;
        const newWidth = Math.max(160, Math.min(e.clientX, 600));
        sidebarEl.style.width = newWidth + 'px';
        let scale = newWidth / 192;
        sidebarEl.style.setProperty('--icon-size', Math.max(20, Math.min(64, Math.round(24 * scale))) + 'px');
        sidebarEl.style.setProperty('--icon-font', Math.max(10, Math.min(18, Math.round(10 * scale))) + 'px');
        if (typeof resize === 'function') resize();
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizingSidebar) {
            isResizingSidebar = false;
            document.body.style.cursor = '';
            if (typeof resize === 'function') resize(); // trigger canvas resize to fit new space
        }
    });
}
