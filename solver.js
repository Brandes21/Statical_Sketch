// solver.js
// This file handles the translation of the Sketch Geometry into an FE model format

// Helper to determine if two points are conceptually the same location
// Increased tolerance to 0.05 to better catch objects placed slightly off-grid visually
const DIST_TOLERANCE = 0.05;

function distSolver(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// Main translation function
function buildFEModel(entities, gridSize) {
    const nodes = [];
    const elements = [];
    const pointsLoads = [];
    const distLoads = [];
    
    // Internal helper to get or create a node at a given point
    function getOrCreateNode(pt) {
        // Convert to FE coordinates (Canvas Y is down, FE Y is typically up)
        // Divide by gridSize to get units in meters (if grid = 1m)
        const fePt = {
            x: pt.x / gridSize,
            y: -pt.y / gridSize
        };
        
        for (let i = 0; i < nodes.length; i++) {
            if (distSolver(fePt, nodes[i]) < DIST_TOLERANCE) {
                return i;
            }
        }
        
        // Define default degrees of freedom: Free (false means no restraint)
        nodes.push({
            id: nodes.length,
            x: fePt.x,
            y: fePt.y,
            restraints: { ux: false, uy: false, rz: false }
        });
        
        return nodes.length - 1;
    }

    const virtualBeams = [];
    
    // Discretize arcs and parabolas first
    for (const ent of entities) {
        if (ent.type === 'parabola' && ent.p3) {
            const steps = 15;
            let lastPt = ent.p1;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const u = 1 - t;
                const x = u*u*ent.p1.x + 2*u*t*ent.p3.x + t*t*ent.p2.x;
                const y = u*u*ent.p1.y + 2*u*t*ent.p3.y + t*t*ent.p2.y;
                const pt = { x, y };
                virtualBeams.push({ type: 'beam', p1: lastPt, p2: pt, isTruss: false, E: ent.E, A: ent.A, I: ent.I });
                lastPt = pt;
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
                        const pt = { x: cx + Math.abs(R) * Math.cos(ang), y: cy + Math.abs(R) * Math.sin(ang) };
                        // For the very last step, ensure numerical exactness to p2
                        if (i === steps) {
                            pt.x = ent.p2.x; pt.y = ent.p2.y;
                        }
                        virtualBeams.push({ type: 'beam', p1: lastPt, p2: pt, isTruss: false, E: ent.E, A: ent.A, I: ent.I });
                        lastPt = pt;
                    }
                } else {
                    virtualBeams.push({ type: 'beam', p1: ent.p1, p2: ent.p2, isTruss: false, E: ent.E, A: ent.A, I: ent.I });
                }
            }
        }
    }
    
    // Combine virtual beams into the processing flow
    const processedEntities = [...entities, ...virtualBeams];

    // 1. Gather all unique points of interest FIRST (Endpoints, Supports, and Loads, Hinges)
    for (const ent of processedEntities) {
        if (ent.type === 'beam' || ent.type === 'distload') {
            getOrCreateNode(ent.p1);
            getOrCreateNode(ent.p2);
        } else if (['pin', 'roller', 'fixed', 'moment', 'hinge', 'spring', 'rotspr'].includes(ent.type)) {
            getOrCreateNode(ent.p1);
        } else if (ent.type === 'force') {
            getOrCreateNode(ent.p2);
        }
    }

    // 2. Process Geometry (Beams / Trusses) - split by any nodes lying on them!
    for (const ent of processedEntities) {
        if (ent.type === 'beam') {
            const feP1 = { x: ent.p1.x / gridSize, y: -ent.p1.y / gridSize };
            const feP2 = { x: ent.p2.x / gridSize, y: -ent.p2.y / gridSize };
            const beamLen = distSolver(feP1, feP2);
            
            // Find all nodes that fall on this beam's path
            const nodesOnBeam = [];
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                const d1 = distSolver(feP1, n);
                const d2 = distSolver(n, feP2);
                // If sum of distances matches beam length, node is on the line
                if (Math.abs((d1 + d2) - beamLen) < DIST_TOLERANCE) {
                    nodesOnBeam.push({ id: n.id, dist: d1 });
                }
            }
            
            // Sort intermediate nodes by distance from start point
            nodesOnBeam.sort((a, b) => a.dist - b.dist);
            
            // Create sub-elements bridging these nodes
            if (nodesOnBeam.length >= 2) {
                for (let i = 0; i < nodesOnBeam.length - 1; i++) {
                    const n1 = nodesOnBeam[i].id;
                    const n2 = nodesOnBeam[i + 1].id;
                    if (n1 !== n2) {
                        elements.push({
                            id: elements.length,
                            type: ent.isTruss ? 'truss' : 'frame',
                            n1: n1,
                            n2: n2,
                            // Default generic properties for a proxy sketch solver
                            E: 200e9,   // Young's Modulus
                            A: 0.01,    // Area
                            I: 1e-4     // Moment of Inertia
                        });
                    }
                }
            }
        }
    }

    // 3. Process Boundary Conditions
    for (const ent of processedEntities) {
        if (['pin', 'roller', 'fixed', 'hinge', 'spring', 'rotspr'].includes(ent.type)) {
            const nId = getOrCreateNode(ent.p1);
            
            if (ent.type === 'hinge') {
                nodes[nId].isHinge = true;
            } else if (['spring', 'rotspr'].includes(ent.type)) {
                // Initialize springs array if it doesn't exist
                if (!nodes[nId].springs) nodes[nId].springs = [];
                nodes[nId].springs.push({
                    type: ent.type,
                    stiffness: ent.stiffness !== undefined ? parseFloat(ent.stiffness) : 1000,
                    stiffnessTrans: ent.stiffnessTrans !== undefined ? parseFloat(ent.stiffnessTrans) : 0,
                    angle: ent.angle || 0
                });
            } else {
                // Capture the angle of the support (in radians) for coordinate transformation in the solver
                nodes[nId].supportAngle = ent.angle || 0;
                
                if (ent.type === 'fixed') {
                    nodes[nId].restraints = { ux: true, uy: true, rz: true };
                } else if (ent.type === 'pin') {
                    nodes[nId].restraints = { ux: true, uy: true, rz: false };
                } else if (ent.type === 'roller') {
                    // A roller theoretically restrains perpendicular to its sliding plane.
                    // The FE solver will use supportAngle to rotate the global restraint vectors.
                    nodes[nId].restraints = { ux: false, uy: true, rz: false };
                }
            }
        }
    }

    // 4. Process Loads
    for (const ent of processedEntities) {
        if (ent.type === 'moment') {
            const nId = getOrCreateNode(ent.p1);
            const mag = parseFloat(ent.magnitude || "10");
            pointsLoads.push({ node: nId, fx: 0, fy: 0, mz: -mag }); // Negative assuming clockwise logic
        } else if (ent.type === 'force') {
            const nId = getOrCreateNode(ent.p2); // Force is applied at the tip (p2)
            const mag = parseFloat(ent.magnitude || "10");
            
            // Vector from start (p1) to tip (p2)
            const dx = ent.p2.x - ent.p1.x;
            const dy = ent.p2.y - ent.p1.y;
            const len = Math.hypot(dx, dy);
            
            // Normalized direction vector in Canvas space
            const ux = len > 0 ? dx / len : 0;
            const uy = len > 0 ? dy / len : 0;
            
            pointsLoads.push({
                node: nId,
                fx: mag * ux,
                fy: mag * -uy, // FE y is up, Canvas y is down. So pointing down (uy > 0) means FE fy < 0
                mz: 0
            });
        } else if (ent.type === 'distload') {
            // Very simplified projection to nodes for now, or just mapping to element geometry
            const n1 = getOrCreateNode(ent.p1);
            const n2 = getOrCreateNode(ent.p2);
            distLoads.push({
                n1: n1,
                n2: n2,
                w1: parseFloat(ent.startMagnitude || "10"),
                w2: parseFloat(ent.endMagnitude || ent.startMagnitude || "10")
            });
        }
    }

    return {
        nodes: nodes,
        elements: elements,
        pointsLoads: pointsLoads,
        distLoads: distLoads
    };
}

// --- Math Utilities ---
// Standard Gaussian Elimination for dense matrices
function solveLinearSystem(A, b) {
    const n = b.length;
    for (let p = 0; p < n; p++) {
        let max = p;
        for (let i = p + 1; i < n; i++) {
            if (Math.abs(A[i][p]) > Math.abs(A[max][p])) max = i;
        }
        let temp = A[p]; A[p] = A[max]; A[max] = temp;
        let t = b[p]; b[p] = b[max]; b[max] = t;

        // Tolerance adjusted to 1e-4 because typical structural stiffness ranges 1e6 ~ 1e9. 
        // Float precision noise from eliminating those huge stiffnesses can evaluate to 1e-8.
        if (Math.abs(A[p][p]) <= 1e-4) {
            console.error("Singular pivot detected at DOF", p, "Value:", A[p][p]);
            return null; // Singular matrix
        }

        for (let i = p + 1; i < n; i++) {
            let alpha = A[i][p] / A[p][p];
            b[i] -= alpha * b[p];
            for (let j = p; j < n; j++) {
                A[i][j] -= alpha * A[p][j];
            }
        }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) sum += A[i][j] * x[j];
        x[i] = (b[i] - sum) / A[i][i];
    }
    return x;
}

// Matrix Stiffness Solver
function solveFEModel(model) {
    const numNodes = model.nodes.length;
    const numDOFs = numNodes * 3;
    
    // Initialize global K matrix and F vector
    let K = Array(numDOFs).fill(0).map(() => Array(numDOFs).fill(0));
    let F = new Array(numDOFs).fill(0);
    
    // Assemble Elements
    for (let eIdx = 0; eIdx < model.elements.length; eIdx++) {
        const el = model.elements[eIdx];
        const n1 = model.nodes[el.n1];
        const n2 = model.nodes[el.n2];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const L = Math.hypot(dx, dy);
        if (L === 0) continue;
        
        const c = dx / L;
        // Adjust for typical FE y-axis pointing up whereas canvas typically points Y down. 
        // We already inverted Y in 'buildFEModel', so math matches standard matrix formulation
        const s = dy / L;
        
        const E = el.E || 200e9; // N/m^2
        const A = el.A || 0.01;  // m^2
        const I = el.I || 1e-4;  // m^4
        
        // Element stiffness matrix in local coordinates (6x6)
        let k = Array(6).fill(0).map(() => Array(6).fill(0));
        const kAxial = E * A / L;
        
        k[0][0] = kAxial; k[0][3] = -kAxial;
        k[3][0] = -kAxial; k[3][3] = kAxial;
        
        // Handle internal hinges at either end of the element
        const h1 = n1.isHinge;
        const h2 = n2.isHinge;

        if (el.type !== 'truss' && (!h1 || !h2)) {
            if (h1 && !h2) {
                // Member hinged at the start (n1) only
                const k1_h = 3 * E * I / (L * L * L);
                const k2_h = 3 * E * I / (L * L);
                const k3_h = 3 * E * I / L;
                
                k[1][1] = k1_h;  k[1][4] = -k1_h; k[1][5] = k2_h;
                k[4][1] = -k1_h; k[4][4] = k1_h;  k[4][5] = -k2_h;
                k[5][1] = k2_h;  k[5][4] = -k2_h; k[5][5] = k3_h;
            } else if (!h1 && h2) {
                // Member hinged at the end (n2) only
                const k1_h = 3 * E * I / (L * L * L);
                const k2_h = 3 * E * I / (L * L);
                const k3_h = 3 * E * I / L;
                
                k[1][1] = k1_h;  k[1][2] = k2_h;  k[1][4] = -k1_h;
                k[2][1] = k2_h;  k[2][2] = k3_h;  k[2][4] = -k2_h;
                k[4][1] = -k1_h; k[4][2] = -k2_h; k[4][4] = k1_h;
            } else {
                // Standard rigid frame member
                const k1 = 12 * E * I / (L * L * L);
                const k2 = 6 * E * I / (L * L);
                const k3 = 4 * E * I / L;
                const k4 = 2 * E * I / L;
                
                k[1][1] = k1; k[1][2] = k2; k[1][4] = -k1; k[1][5] = k2;
                k[2][1] = k2; k[2][2] = k3; k[2][4] = -k2; k[2][5] = k4;
                k[4][1] = -k1; k[4][2] = -k2; k[4][4] = k1; k[4][5] = -k2;
                k[5][1] = k2; k[5][2] = k4; k[5][4] = -k2; k[5][5] = k3;
            }
        }

        // Transformation matrix T (local to global)
        const T = [
            [c, s, 0, 0, 0, 0],
            [-s, c, 0, 0, 0, 0],
            [0, 0, 1, 0, 0, 0],
            [0, 0, 0, c, s, 0],
            [0, 0, 0, -s, c, 0],
            [0, 0, 0, 0, 0, 1]
        ];
        
        // K_global_e = T^T * k * T
        let kg = Array(6).fill(0).map(() => Array(6).fill(0));
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 6; j++) {
                for (let a = 0; a < 6; a++) {
                    for (let b = 0; b < 6; b++) {
                        kg[i][j] += T[a][i] * k[a][b] * T[b][j];
                    }
                }
            }
        }
        
        // Save these for internal forces extraction later if needed
        el.localK = k; 
        el.T = T;
        el.f_fixed = [0, 0, 0, 0, 0, 0]; // Init fixed end forces sum
        
        // Assemble into global K
        const dofMap = [el.n1*3, el.n1*3+1, el.n1*3+2, el.n2*3, el.n2*3+1, el.n2*3+2];
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 6; j++) {
                K[dofMap[i]][dofMap[j]] += kg[i][j];
            }
        }
    }
    
    // Add Point Loads
    for (const pl of model.pointsLoads) {
        F[pl.node * 3] += pl.fx;
        F[pl.node * 3 + 1] += pl.fy;
        F[pl.node * 3 + 2] += pl.mz;
    }

    // Add Equivalent Nodal Forces for Distributed Loads (Fixed End Forces)
    for (const dl of model.distLoads) {
        const ln1 = model.nodes[dl.n1];
        const ln2 = model.nodes[dl.n2];
        const dlLen = Math.hypot(ln2.x - ln1.x, ln2.y - ln1.y);
        if (dlLen === 0) continue;
        
        for (let eIdx = 0; eIdx < model.elements.length; eIdx++) {
            const el = model.elements[eIdx];
            const en1 = model.nodes[el.n1];
            const en2 = model.nodes[el.n2];
            
            const ecx = (en1.x + en2.x) / 2;
            const ecy = (en1.y + en2.y) / 2;
            
            const d1 = Math.hypot(ecx - ln1.x, ecy - ln1.y);
            const d2 = Math.hypot(ln2.x - ecx, ln2.y - ecy);
            
            // Check if element center geometrically lies on the dist load path
            if (Math.abs((d1 + d2) - dlLen) < DIST_TOLERANCE) {
                const elLen = Math.hypot(en2.x - en1.x, en2.y - en1.y);
                
                // Interpolate load magnitudes at element start and end
                const dStart = Math.hypot(en1.x - ln1.x, en1.y - ln1.y);
                const dEnd = Math.hypot(en2.x - ln1.x, en2.y - ln1.y);
                
                const wStart = dl.w1 + (dl.w2 - dl.w1) * (dStart / dlLen);
                const wEnd = dl.w1 + (dl.w2 - dl.w1) * (dEnd / dlLen);
                
                // Average load (simplified rectangular area for Fixed End Forces)
                // Assuming wAvg represents a gravity/transverse load pushing in the local -y direction
                const wAvg = (wStart + wEnd) / 2;
                
                const h1 = en1.isHinge;
                const h2 = en2.isHinge;
                
                let f_local;
                if (el.type === 'truss' || (h1 && h2)) {
                    // Pinned-Pinned: purely shear transfer to nodes
                    f_local = [0, -wAvg * elLen / 2, 0, 0, -wAvg * elLen / 2, 0];
                } else if (h1 && !h2) {
                    // Pinned-Fixed
                    f_local = [
                        0, 
                        - (3 * wAvg * elLen) / 8, 
                        0,
                        0, 
                        - (5 * wAvg * elLen) / 8, 
                        (wAvg * elLen * elLen) / 8
                    ];
                } else if (!h1 && h2) {
                    // Fixed-Pinned
                    f_local = [
                        0, 
                        - (5 * wAvg * elLen) / 8, 
                        - (wAvg * elLen * elLen) / 8,
                        0, 
                        - (3 * wAvg * elLen) / 8, 
                        0
                    ];
                } else {
                    // Standard Rigid Fixed-Fixed ends
                    f_local = [
                        0, 
                        -wAvg * elLen / 2, 
                        -wAvg * elLen * elLen / 12,
                        0, 
                        -wAvg * elLen / 2, 
                        wAvg * elLen * elLen / 12
                    ];
                }
                
                // Accumulate local fixed end forces for post-processing internal forces overlay
                for (let i = 0; i < 6; i++) el.f_fixed[i] += f_local[i];

                // Convert to global Equivalent Nodal Forces: F_global = T^T * f_local
                const T = el.T;
                let f_global = [0,0,0,0,0,0];
                for (let i = 0; i < 6; i++) {
                    for (let j = 0; j < 6; j++) {
                        f_global[i] += T[j][i] * f_local[j]; 
                    }
                }
                
                // Add to global Matrix Force vector
                const dofMap = [el.n1*3, el.n1*3+1, el.n1*3+2, el.n2*3, el.n2*3+1, el.n2*3+2];
                for (let i = 0; i < 6; i++) {
                    F[dofMap[i]] += f_global[i];
                }
            }
        }
    }
    
    // Ensure no purely empty diagonal entries exist before solving, which occurs 
    // for instance on truss nodes (which have no rotational stiffness) or completely free unattached nodes.
    for (let i = 0; i < numDOFs; i++) {
        if (K[i][i] === 0) {
            K[i][i] = 1.0;
        }
    }

    // Process Boundary Conditions using the Penalty Method
    const PENALTY = 1e12;
    for (const n of model.nodes) {
        const dofX = n.id * 3;
        const dofY = n.id * 3 + 1;
        const dofZ = n.id * 3 + 2;
        
        // Add Elastic Springs
        if (n.springs) {
            for (const sp of n.springs) {
                if (sp.type === 'rotspr') {
                    K[dofZ][dofZ] += sp.stiffness;
                } else if (sp.type === 'spring') {
                    const ang = sp.angle;
                    const c = Math.cos(ang);
                    const s = Math.sin(ang);
                    
                    const k_a = sp.stiffness;
                    const k_t = sp.stiffnessTrans || 0;
                    
                    // Spring visually draws downwards along Y naturally when angle=0.
                    // So k_a aligns with Local Y, and k_t aligns with Local X.
                    K[dofX][dofX] += (k_t * c * c) + (k_a * s * s);
                    K[dofY][dofY] += (k_t * s * s) + (k_a * c * c);
                    K[dofX][dofY] += (k_t - k_a) * c * s;
                    K[dofY][dofX] += (k_t - k_a) * c * s;
                }
            }
        }
        
        if (!n.restraints) continue;
        
        const alpha = n.supportAngle || 0;
        const s_ang = Math.sin(-alpha); 
        const c_ang = Math.cos(-alpha);
        
        if (n.restraints.ux && n.restraints.uy) {
            // Pinned/Fixed in both directions completely eliminates translation
            K[dofX][dofX] += PENALTY;
            K[dofY][dofY] += PENALTY;
        } else if (n.restraints.ux) {
            // Locks along its Local X (e.g., sliding perpendicular to that)
            K[dofX][dofX] += PENALTY * c_ang * c_ang;
            K[dofX][dofY] += PENALTY * c_ang * s_ang;
            K[dofY][dofX] += PENALTY * s_ang * c_ang;
            K[dofY][dofY] += PENALTY * s_ang * s_ang;
        } else if (n.restraints.uy) {
            // Locks along its Local Y (e.g., standard Roller resistance axis)
            const ny_x = -s_ang;
            const ny_y = c_ang;
            K[dofX][dofX] += PENALTY * ny_x * ny_x;
            K[dofX][dofY] += PENALTY * ny_x * ny_y;
            K[dofY][dofX] += PENALTY * ny_y * ny_x;
            K[dofY][dofY] += PENALTY * ny_y * ny_y;
        }
        
        if (n.restraints.rz) {
            K[dofZ][dofZ] += PENALTY;
        }
    }
    
    // Solve K * U = F
    const U = solveLinearSystem(K, F);
    
    if (!U) {
        return { success: false, error: "Matrix is singular. The structure is mathematically unstable (e.g. mechanism, not enough supports, or unconnected free flying nodes)." };
    }
    
    // Extract results into nodes
    for (let i = 0; i < numNodes; i++) {
        model.nodes[i].ux = U[i * 3];
        model.nodes[i].uy = U[i * 3 + 1];
        model.nodes[i].rz = U[i * 3 + 2];
    }
    
    // Post-Process: Calculate Internal Element Forces (Axial, Shear, Moment)
    for (let eIdx = 0; eIdx < model.elements.length; eIdx++) {
        const el = model.elements[eIdx];
        const dofMap = [el.n1*3, el.n1*3+1, el.n1*3+2, el.n2*3, el.n2*3+1, el.n2*3+2];
        const u_global = dofMap.map(idx => U[idx]);
        
        // u_local = T * u_global
        let u_local = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 6; j++) {
                u_local[i] += el.T[i][j] * u_global[j];
            }
        }
        
        // f_local_internal = k_local * u_local - f_fixed
        // (f_fixed are equivalent nodal forces ON the nodes, so we subtract them to get forces ON the element)
        let f_int = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 6; i++) {
            for (let j = 0; j < 6; j++) {
                f_int[i] += el.localK[i][j] * u_local[j];
            }
            f_int[i] -= el.f_fixed[i]; 
        }
        
        // Store for BMD/SFD visualization
        el.forces = {
            N1: f_int[0], V1: f_int[1], M1: f_int[2],
            N2: f_int[3], V2: f_int[4], M2: f_int[5]
        };
        el.u_local = u_local;
        el.u_global = u_global;
    }

    // Post-Process: Determine Support Reactions
    // Sum internal forces at each node and subtract applied nodal loads
    for (const n of model.nodes) {
        n.reactions = { fx: 0, fy: 0, mz: 0 };
        if (n.restraints && (n.restraints.ux || n.restraints.uy || n.restraints.rz)) {
            const dofX = n.id * 3;
            const dofY = n.id * 3 + 1;
            const dofZ = n.id * 3 + 2;
            // Reactions = K_unmodified * U - F 
            // BUT since we modified K directly with penalty method, we have to extract 
            // the force going through the penalty spring: R = PENALTY * U
            
            const alpha = n.supportAngle || 0;
            const s_ang = Math.sin(-alpha); 
            const c_ang = Math.cos(-alpha);
            
            let Rx = 0;
            let Ry = 0;
            let Mz = 0;
            
            if (n.restraints.ux && n.restraints.uy) {
                Rx = -PENALTY * n.ux;
                Ry = -PENALTY * n.uy;
            } else if (n.restraints.ux) {
                // Recover local reaction, then rotate back
                const u_local_x = n.ux * c_ang + n.uy * s_ang;
                const r_local_x = -PENALTY * u_local_x;
                Rx = r_local_x * c_ang;
                Ry = r_local_x * s_ang;
            } else if (n.restraints.uy) {
                // Recover local reaction, then rotate back
                const u_local_y = -n.ux * s_ang + n.uy * c_ang;
                const r_local_y = -PENALTY * u_local_y;
                Rx = -r_local_y * s_ang;
                Ry = r_local_y * c_ang;
            }
            
            if (n.restraints.rz) {
                Mz = -PENALTY * n.rz;
            }
            
            n.reactions = { fx: Rx, fy: Ry, mz: Mz };
        }
        
        // Calculate and append elastic spring reactions 
        if (n.springs) {
            for (const sp of n.springs) {
                if (sp.type === 'rotspr') {
                    n.reactions.mz += -sp.stiffness * n.rz;
                } else if (sp.type === 'spring') {
                    const ang = sp.angle;
                    const c = Math.cos(ang);
                    const s = Math.sin(ang);
                    
                    const k_a = sp.stiffness;
                    const k_t = sp.stiffnessTrans || 0;
                    
                    // Local Displacements
                    const u_local_x = n.ux * c + n.uy * s;
                    const u_local_y = -n.ux * s + n.uy * c;
                    
                    // Spring visually draws downwards along Y naturally when angle=0.
                    // So k_a aligns with Local Y, and k_t aligns with Local X.
                    const r_local_x = -k_t * u_local_x;
                    const r_local_y = -k_a * u_local_y;
                    
                    // Transform to Global Spring Forces
                    n.reactions.fx += r_local_x * c - r_local_y * s;
                    n.reactions.fy += r_local_x * s + r_local_y * c;
                }
            }
        }
    }
    
    return { 
        success: true, 
        model: model, 
        displacements: U 
    };
}
