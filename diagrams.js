function drawFEDiagrams(ctx, results, activeDiagram, dScale = 1.0, mouseWp = null, appState = null) {
    if (!results || !results.success || !activeDiagram) return;
    
    const minMaxOnly = appState ? appState.diagramMinMaxOnly : false;
    const textSize = appState && appState.diagramTextSize ? appState.diagramTextSize : 10;

    if (activeDiagram === 'influence' && results.isInfluence) {
        if (!results.influencePoints || results.influencePoints.length === 0) return;
        const pts = results.influencePoints;
        const vals = results.influenceValues;
        const s = state.vw.z; 
        
        let maxVal = 0;
        let pPeak = 0, pPeakIdx = 0;
        let nPeak = 0, nPeakIdx = 0;
        vals.forEach((v, i) => { 
            if (Math.abs(v) > maxVal) maxVal = Math.abs(v); 
            if (v > pPeak) { pPeak = v; pPeakIdx = i; }
            if (v < nPeak) { nPeak = v; nPeakIdx = i; }
        });
        if (maxVal < 1e-9) maxVal = 1;
        
        const aScale = (50 / s) * dScale; 

        // Precompute normals for perpendicular drawing
        const normals = pts.map((p, i) => {
            let dx, dy;
            if (i < pts.length - 1) {
                dx = pts[i+1].x - p.x;
                dy = pts[i+1].y - p.y;
            } else if (i > 0) {
                dx = p.x - pts[i-1].x;
                dy = p.y - pts[i-1].y;
            } else { dx = 1; dy = 0; }
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return { x: 0, y: -1 };
            return { x: dy / len, y: -dx / len }; 
        });
        
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const px = pts[i].x + normals[i].x * (vals[i] / maxVal) * aScale;
            const py = pts[i].y + normals[i].y * (vals[i] / maxVal) * aScale;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        
        ctx.lineWidth = 2 / s;
        ctx.strokeStyle = '#4f46e5'; // indigo
        ctx.stroke();

        ctx.fillStyle = 'rgba(79, 70, 229, 0.2)';
        ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
        for (let i = pts.length - 1; i >= 0; i--) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#4f46e5';
        ctx.font = `${textSize/s}px monospace`;
        ctx.textAlign = 'center';
        if (pPeak > 1e-3) {
            const pt = pts[pPeakIdx];
            const n = normals[pPeakIdx];
            ctx.textBaseline = 'bottom';
            ctx.fillText(pPeak.toFixed(2), pt.x + n.x * (pPeak / maxVal) * aScale, pt.y + n.y * (pPeak / maxVal) * aScale - 4/s);
        }
        if (nPeak < -1e-3) {
            const pt = pts[nPeakIdx];
            const n = normals[nPeakIdx];
            ctx.textBaseline = 'top';
            ctx.fillText(nPeak.toFixed(2), pt.x + n.x * (nPeak / maxVal) * aScale, pt.y + n.y * (nPeak / maxVal) * aScale + 4/s);
        }

        // Draw Target Marker
        if (results.infTarget && results.infTarget.type === 'internal') {
            const ent = results.infTarget.entity;
            ctx.beginPath();
            ctx.moveTo(ent.p1.x, ent.p1.y);
            ctx.lineTo(ent.p2.x, ent.p2.y);
            ctx.strokeStyle = '#ef4444'; // red
            ctx.lineWidth = 3 / s;
            ctx.stroke();
        }

        // Draw hover for Influence Lines
        if (mouseWp && mouseWp.x !== undefined && mouseWp.y !== undefined) {
            let closestDist = Infinity;
            let closestIdx = -1;
            for (let i = 0; i < pts.length; i++) {
                const d = Math.hypot(pts[i].x - mouseWp.x, pts[i].y - mouseWp.y);
                if (d < closestDist) {
                    closestDist = d;
                    closestIdx = i;
                }
            }
            // 40/s means 40 pixels snap distance
            if (closestDist < 40/s && closestIdx !== -1) {
                const hv = vals[closestIdx];
                const hp = pts[closestIdx];
                const n = normals[closestIdx];
                const hx = hp.x + n.x * (hv / maxVal) * aScale;
                const hy = hp.y + n.y * (hv / maxVal) * aScale;

                ctx.beginPath();
                ctx.arc(hx, hy, 4/s, 0, Math.PI*2);
                ctx.fillStyle = '#4f46e5';
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5/s;
                ctx.stroke();

                ctx.fillStyle = 'black';
                ctx.font = `bold ${textSize/s}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = hv > -1e-6 ? 'bottom' : 'top';
                const yOff = hv > -1e-6 ? -8/s : 8/s;
                ctx.fillText(hv.toFixed(2), hx, hy + yOff);
            }
        }

        return; // Important: escape here so we don't try to read model.nodes!
    }

    const model = results.model;
    if (!model) return;
    const s = state.vw.z; 
    
    // Scale factors
    // Find absolute maximums
    let maxDisp = 1e-9;
    let maxN = 1e-9;
    let maxV = 1e-9;
    let maxM = 1e-9;

    let minAfdVal = Infinity;
    let minSfdVal = Infinity;
    let minBmdVal = Infinity;
    
    model.nodes.forEach(n => {
        const d = Math.hypot(n.ux, n.uy);
        if (d > maxDisp) maxDisp = d;
    });
    
    model.elements.forEach(el => {
        const f = el.forces;
        maxN = Math.max(maxN, Math.abs(f.N1), Math.abs(f.N2));
        maxV = Math.max(maxV, Math.abs(f.V1), Math.abs(f.V2));
        maxM = Math.max(maxM, Math.abs(f.M1), Math.abs(f.M2));
        
        if (Math.abs(f.N1) > 1e-3) minAfdVal = Math.min(minAfdVal, Math.abs(f.N1));
        if (Math.abs(f.N2) > 1e-3) minAfdVal = Math.min(minAfdVal, Math.abs(f.N2));
        if (Math.abs(f.V1) > 1e-3) minSfdVal = Math.min(minSfdVal, Math.abs(f.V1));
        if (Math.abs(f.V2) > 1e-3) minSfdVal = Math.min(minSfdVal, Math.abs(f.V2));
        if (Math.abs(f.M1) > 1e-3) minBmdVal = Math.min(minBmdVal, Math.abs(f.M1));
        if (Math.abs(f.M2) > 1e-3) minBmdVal = Math.min(minBmdVal, Math.abs(f.M2));
        
        // Also check intermediate moments for distributed loads
        if (activeDiagram === 'bmd') {
            const Lfe = Math.hypot(model.nodes[el.n2].x - model.nodes[el.n1].x, model.nodes[el.n2].y - model.nodes[el.n1].y);
            if (Lfe > 0) {
                const w = (f.V1 + f.V2) / Lfe;
                const m1 = -f.M1;
                for (let i = 1; i <= 20; i++) {
                    const xLoc = (i/20) * Lfe;
                    const mLoc = m1 + f.V1 * xLoc - w * xLoc * xLoc / 2;
                    maxM = Math.max(maxM, Math.abs(mLoc));
                    if (Math.abs(mLoc) > 1e-3) minBmdVal = Math.min(minBmdVal, Math.abs(mLoc));
                }
            }
        }

        if (el.u_local && activeDiagram === 'deflection') {
            const h1 = model.nodes[el.n1].isHinge;
            const h2 = model.nodes[el.n2].isHinge;
            const L = Math.hypot(model.nodes[el.n2].x - model.nodes[el.n1].x, model.nodes[el.n2].y - model.nodes[el.n1].y);
            if (L > 0) {
                const w = (f.V1 + f.V2) / L; 
                const EI = (el.E || 200e9) * (el.I || 1e-4);
                
                const v1 = el.u_local[1];
                const a1 = el.u_local[2];
                const v2 = el.u_local[4];
                const a2 = el.u_local[5];
                
                for (let i = 0; i <= 10; i++) {
                    const xi = i / 10;
                    const x = xi * L;
                    
                    const N1 = 1 - 3*xi*xi + 2*xi*xi*xi;
                    const N2 = L * (xi - 2*xi*xi + xi*xi*xi);
                    const N3 = 3*xi*xi - 2*xi*xi*xi;
                    const N4 = L * (-xi*xi + xi*xi*xi);
                    
                    let vp = 0;
                    if (!h1 && !h2) {
                        vp = -(w * x*x * (L-x)*(L-x)) / (24 * EI);
                    }
                    
                    const localY = N1*v1 + N2*a1 + N3*v2 + N4*a2 + vp;
                    const localX = (1-xi)*el.u_local[0] + xi*el.u_local[3];
                    
                    const d = Math.hypot(localX, localY);
                    if (d > maxDisp) maxDisp = d;
                }
            }
        }
    });

    const vScale = (40 / s) * dScale; // Maximum visible pixel amplitude for diagrams

    // Colors
    const colDeflect = 'rgba(234, 88, 12, 0.8)'; // orange-600
    const colM = 'rgba(59, 130, 246, 0.5)'; // blue-500
    const colM_edge = 'rgba(37, 99, 235, 1.0)'; // blue-600
    const colV = 'rgba(16, 185, 129, 0.5)'; // emerald-500
    const colV_edge = 'rgba(5, 150, 105, 1.0)'; // emerald-600
    const colN = 'rgba(168, 85, 247, 0.5)'; // purple-500
    const colN_edge = 'rgba(147, 51, 234, 1.0)'; // purple-600
    
    // Function to transform world point to visual canvas space inside the translation loop
    const toCX = (x) => x * state.gridSize;
    const toCY = (y) => -y * state.gridSize;
    
    if (activeDiagram === 'deflection') {
        const dispScale = maxDisp > 1e-12 ? vScale / maxDisp : 0;
        ctx.strokeStyle = colDeflect;
        ctx.lineWidth = 2 / s;
        ctx.setLineDash([5/s, 5/s]);
        
        let hoverData = null;

        ctx.beginPath();
        model.elements.forEach(el => {
            const n1 = model.nodes[el.n1];
            const n2 = model.nodes[el.n2];
            const cX1 = toCX(n1.x);
            const cY1 = toCY(n1.y);
            const cX2 = toCX(n2.x);
            const cY2 = toCY(n2.y);
            
            const dx = cX2 - cX1;
            const dy = cY2 - cY1;
            const L = Math.hypot(dx, dy);
            const ang = Math.atan2(dy, dx);
            
            // Reconstruct FE structural C and S exactly as solver.js did for transforming back safely
            const fe_dx = n2.x - n1.x;
            const fe_dy = n2.y - n1.y;
            const L_fe = Math.hypot(fe_dx, fe_dy) || 1;
            const fe_c = fe_dx / L_fe;
            const fe_s = fe_dy / L_fe;
            
            // Function to compute local deflections
            const getDeflection = (xi) => {
                if (!el.u_local || L === 0) return { uxHover: (1-xi)*n1.ux + xi*n2.ux, uyHover: (1-xi)*n1.uy + xi*n2.uy };
                
                const f = el.forces;
                let w = (f.V1 + f.V2) / (Math.hypot(n2.x - n1.x, n2.y - n1.y) || 1);
                const EI = (el.E || 200e9) * (el.I || 1e-4);
                
                const v1 = el.u_local[1];
                const a1 = el.u_local[2];
                const v2 = el.u_local[4];
                const a2 = el.u_local[5];
                
                const x = xi * (L / state.gridSize); // real length
                const L_real = L / state.gridSize;
                
                const N1 = 1 - 3*xi*xi + 2*xi*xi*xi;
                const N2 = L_real * (xi - 2*xi*xi + xi*xi*xi);
                const N3 = 3*xi*xi - 2*xi*xi*xi;
                const N4 = L_real * (-xi*xi + xi*xi*xi);
                
                const h1 = n1.isHinge;
                const h2 = n2.isHinge;
                let vp = 0;
                if (!h1 && !h2) {
                    vp = -(w * x*x * (L_real-x)*(L_real-x)) / (24 * EI);
                }
                
                const localY = N1*v1 + N2*a1 + N3*v2 + N4*a2 + vp;
                const localX = (1-xi)*el.u_local[0] + xi*el.u_local[3];
                
                // Convert exact local displacements back to global UX/UY using transposed T matrix
                const ux = localX * fe_c - localY * fe_s;
                const uy = localX * fe_s + localY * fe_c;
                return { uxHover: ux, uyHover: uy };
            };
            
            ctx.moveTo(cX1 + n1.ux * dispScale, cY1 - n1.uy * dispScale);
            for (let i = 1; i <= 10; i++) {
                const def = getDeflection(i / 10);
                const segX = cX1 + dx * (i / 10);
                const segY = cY1 + dy * (i / 10);
                ctx.lineTo(segX + def.uxHover * dispScale, segY - def.uyHover * dispScale);
            }
            
            if (mouseWp && mouseWp.x !== undefined) {
                const mx = mouseWp.x - cX1;
                const my = mouseWp.y - cY1;
                const localX = mx * Math.cos(-ang) - my * Math.sin(-ang);
                const localY = mx * Math.sin(-ang) + my * Math.cos(-ang);

                if (localX >= 0 && localX <= L && Math.abs(localY) < 40/s) {
                    const ratio = localX / L;
                    const { uxHover, uyHover } = getDeflection(ratio);
                    
                    const totDisp = Math.hypot(uxHover, uyHover);
                    hoverData = {
                        x: cX1 + dx * ratio + uxHover * dispScale, // Deflected visual X
                        y: cY1 + dy * ratio - uyHover * dispScale, // Deflected visual Y
                        disp: totDisp
                    };
                }
            }
        });
        ctx.stroke();
        ctx.setLineDash([]);
        
        if (hoverData) {
            ctx.fillStyle = 'black';
            ctx.beginPath();
            ctx.arc(hoverData.x, hoverData.y, 4/s, 0, Math.PI*2);
            ctx.fill();
            
            ctx.font = `bold ${textSize/s}px monospace`;
            ctx.textAlign = 'center';
            const label = (hoverData.disp * 1000).toFixed(3) + " mm";
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillRect(hoverData.x - tw/2 - 2/s, hoverData.y - 20/s, tw + 4/s, textSize/s);
            
            ctx.fillStyle = 'black';
            ctx.fillText(label, hoverData.x, hoverData.y - 14/s);
        }
    }
    
    else if (activeDiagram === 'afd' || activeDiagram === 'sfd' || activeDiagram === 'bmd') {
        const isBmd = (activeDiagram === 'bmd');
        const isAfd = (activeDiagram === 'afd');
        const maxVal = isBmd ? maxM : (isAfd ? maxN : maxV);
        const scale = maxVal > 1e-12 ? vScale / maxVal : 0;
        
        ctx.lineWidth = 1.5 / s;
        ctx.font = `${textSize/s}px monospace`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        
        model.elements.forEach(el => {
            const n1 = model.nodes[el.n1];
            const n2 = model.nodes[el.n2];
            
            const cX1 = toCX(n1.x);
            const cY1 = toCY(n1.y);
            const cX2 = toCX(n2.x);
            const cY2 = toCY(n2.y);
            
            const dx = cX2 - cX1;
            const dy = cY2 - cY1;
            const Lfe = Math.hypot(n2.x - n1.x, n2.y - n1.y);
            const L = Math.hypot(dx, dy);
            const ang = Math.atan2(dy, dx);
            
            const f = el.forces;
            // Matrix method: V1 is Y, V2 is Y. M1 is Rz, M2 is Rz.
            // On element, forces acting on ends vs element itself:
            let v1 = f.V1;
            let v2 = -f.V2; // flip because node 2 is opposite side
            let m1 = -f.M1; 
            let m2 = f.M2; 
            let ax1 = -f.N1; // Axial force: tension is positive
            let ax2 = f.N2; 
            
            ctx.save();
            ctx.translate(cX1, cY1);
            ctx.rotate(ang);
            
            ctx.fillStyle = isBmd ? colM : (isAfd ? colN : colV);
            ctx.strokeStyle = isBmd ? colM_edge : (isAfd ? colN_edge : colV_edge);
            
            ctx.beginPath();
            ctx.moveTo(0, 0);
            
            let hoverValue = null;
            let hoverX = null;
            let hoverY = null;
            
            // Check hover for intermediate values
            if (mouseWp && mouseWp.x !== undefined && mouseWp.y !== undefined) {
                // Convert mouse position to local element element coordinate system
                const mx = (mouseWp.x - cX1);
                const my = (mouseWp.y - cY1);
                const localX = mx * Math.cos(-ang) - my * Math.sin(-ang);
                const localY = mx * Math.sin(-ang) + my * Math.cos(-ang);
                
                // If hover is roughly along this beam's length
                if (localX >= 0 && localX <= L && Math.abs(localY) < 40/s) {
                    const ratio = localX / L;
                    const evalLoc = ratio * Lfe;
                    if (activeDiagram === 'afd') {
                        hoverValue = ax1; // Axial forces are constant for internal element spans here
                        hoverX = localX;
                        hoverY = -hoverValue * scale;
                    } else if (activeDiagram === 'sfd') {
                        // V(x) = V1 - w*x 
                        let w = 0; if (el.forces.V1 + el.forces.V2 !== 0) { w = (el.forces.V1 + el.forces.V2) / Lfe; }
                        hoverValue = v1 - w * evalLoc;
                        hoverX = localX;
                        hoverY = -hoverValue * scale;
                    } else {
                        // M(x) = M1 + V1*x - w*x^2/2
                        const w = (f.V1 + f.V2) / Lfe;
                        hoverValue = m1 + f.V1 * evalLoc - w * evalLoc * evalLoc / 2;
                        hoverX = localX;
                        // Flip y calculation to match diagram changes
                        hoverY = hoverValue * scale;
                    }
                }
            }
            
            if (activeDiagram === 'afd') {
                const y1 = -ax1 * scale;
                const y2 = -ax2 * scale;
                ctx.lineTo(0, y1);
                ctx.lineTo(L, y2);
                ctx.lineTo(L, 0);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = ctx.strokeStyle;
                if (!minMaxOnly || Math.abs(Math.abs(ax1) - maxVal) < 1e-3 || Math.abs(Math.abs(ax1) - minAfdVal) < 1e-3) {
                    if (Math.abs(ax1) > 1e-3) ctx.fillText(ax1.toFixed(1), 0, y1 - Math.sign(y1)*10/s);
                }
                if (!minMaxOnly || Math.abs(Math.abs(ax2) - maxVal) < 1e-3 || Math.abs(Math.abs(ax2) - minAfdVal) < 1e-3) {
                    if (Math.abs(ax2) > 1e-3) ctx.fillText(ax2.toFixed(1), L, y2 - Math.sign(y2)*10/s);
                }
            } else if (activeDiagram === 'sfd') {
                const y1 = -v1 * scale;
                const y2 = -v2 * scale;
                ctx.lineTo(0, y1);
                ctx.lineTo(L, y2);
                ctx.lineTo(L, 0);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = ctx.strokeStyle;
                if (!minMaxOnly || Math.abs(Math.abs(v1) - maxVal) < 1e-3 || Math.abs(Math.abs(v1) - minSfdVal) < 1e-3) {
                    if (Math.abs(v1) > 1e-3) ctx.fillText(v1.toFixed(1), 0, y1 - Math.sign(y1)*10/s);
                }
                if (!minMaxOnly || Math.abs(Math.abs(v2) - maxVal) < 1e-3 || Math.abs(Math.abs(v2) - minSfdVal) < 1e-3) {
                    if (Math.abs(v2) > 1e-3) ctx.fillText(v2.toFixed(1), L, y2 - Math.sign(y2)*10/s);
                }
            } else {
                // BMD implies Parabola if w != 0
                const w = (f.V1 + f.V2) / Lfe; // w uses FE length // Recover UDL intensity
                
                // Flip the bending moment diagram visually by removing the negative sign
                // (or flipping to draw on tension side vs compression side depending on standard, 
                // typical standard for civil engineers is drawing on the tension side)
                const y1 = m1 * scale;
                const y2 = m2 * scale;
                
                ctx.lineTo(0, y1);
                
                // Draw parabola / lines
                const segments = 20;
                let maxMloc = 0, xMax = 0, valMax = 0;
                
                for (let i = 1; i <= segments; i++) {
                    const ratio = i/segments;
                    const xLoc = ratio * Lfe;
                    // M(x) = M1 + V1*x - w*x^2/2 (signs depend on convention)
                    const mLoc = m1 + f.V1 * xLoc - w * xLoc * xLoc / 2;
                    ctx.lineTo(ratio * L, mLoc * scale);
                    
                    if (Math.abs(mLoc) > Math.abs(valMax)) {
                        valMax = mLoc;
                        xMax = ratio * L;
                        maxMloc = mLoc * scale;
                    }
                }
                
                ctx.lineTo(L, 0);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = ctx.strokeStyle;
                
                if (!minMaxOnly || Math.abs(Math.abs(m1) - maxVal) < 1e-3 || Math.abs(Math.abs(m1) - minBmdVal) < 1e-3) {
                    if (Math.abs(m1) > 1e-3) ctx.fillText(m1.toFixed(1), 0, y1 - Math.sign(y1)*10/s);
                }
                if (!minMaxOnly || Math.abs(Math.abs(m2) - maxVal) < 1e-3 || Math.abs(Math.abs(m2) - minBmdVal) < 1e-3) {
                    if (Math.abs(m2) > 1e-3) ctx.fillText(m2.toFixed(1), L, y2 - Math.sign(y2)*10/s);
                }
                if (Math.abs(w) > 1e-3 && xMax > 0.1 && xMax < (L-0.1)) {
                    if (!minMaxOnly || Math.abs(Math.abs(valMax) - maxVal) < 1e-3 || Math.abs(Math.abs(valMax) - minBmdVal) < 1e-3) {
                         ctx.fillText(valMax.toFixed(1), xMax, maxMloc - Math.sign(maxMloc)*10/s);
                    }
                }
            }
            
            if (hoverValue !== null) {
                // Draw a marker at the hovered x location for diagram intensity
                ctx.beginPath();
                ctx.moveTo(hoverX, 0);
                ctx.lineTo(hoverX, hoverY);
                ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.setLineDash([4/s, 4/s]);
                ctx.stroke();
                ctx.setLineDash([]);
                
                ctx.fillStyle = 'black';
                ctx.beginPath();
                ctx.arc(hoverX, hoverY, 3/s, 0, Math.PI*2);
                ctx.fill();
                
                // Text background to ensure readability over grid/diagram
                const label = hoverValue.toFixed(2);
                ctx.font = `bold ${textSize/s}px monospace`;
                const textWidth = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                const sign = Math.sign(hoverY) !== 0 ? Math.sign(hoverY) : -1;
                ctx.fillRect(hoverX - textWidth/2 - 2/s, hoverY + sign*5/s - 6/s, textWidth + 4/s, textSize/s);
                
                ctx.fillStyle = 'black';
                ctx.fillText(label, hoverX, hoverY + sign*10/s);
            }
            
            ctx.restore();
        });
    }
    
    if (activeDiagram === 'reactions') {
        const maxR = Math.max(...model.nodes.map(n => n.reactions ? Math.max(Math.abs(n.reactions.fx), Math.abs(n.reactions.fy), Math.abs(n.reactions.mz || 0)) : 0));
        if (maxR < 1e-9) return;
        const aScale = 50 / s; 
        
        ctx.lineWidth = 2 / s;
        ctx.font = `${(textSize+2)/s}px monospace`;
        ctx.fillStyle = '#dc2626'; // red-600
        ctx.strokeStyle = '#dc2626';
        ctx.textBaseline = 'middle';
        
        model.nodes.forEach(n => {
            if (!n.reactions) return;
            const r = n.reactions;
            
            const drawArrow = (fx, fy, val, label) => {
                if (Math.abs(val) < 1e-3) return;
                const len = 30/s + (Math.abs(val)/maxR) * aScale;
                const dir = Math.sign(val);
                
                ctx.save();
                ctx.translate(toCX(n.x), toCY(n.y));
                const ang = Math.atan2(fy, fx);
                ctx.rotate(ang);
                
                // Arrow line
                ctx.beginPath();
                // If positive reaction, arrow points AT node (like a support pushing up)
                const end = dir > 0 ? -len : len;
                ctx.moveTo(0, 0);
                ctx.lineTo(end, 0);
                ctx.stroke();
                
                // Arrowhead
                ctx.beginPath();
                ctx.moveTo(0, 0);
                const ah = 6/s;
                const adir = dir > 0 ? -1 : 1;
                ctx.lineTo(adir*ah, ah/2);
                ctx.lineTo(adir*ah, -ah/2);
                ctx.closePath();
                ctx.fill();
                
                // Text
                ctx.textAlign = dir > 0 ? 'right' : 'left';
                ctx.translate(end + (dir > 0 ? -5/s : 5/s), 0);
                ctx.rotate(-ang); // Keep text straight up
                ctx.fillText(`${label}=${Math.abs(val).toFixed(1)}`, 0, 0);
                
                ctx.restore();
            };
            
            const drawMoment = (val, label) => {
                if (Math.abs(val) < 1e-3) return;
                
                ctx.save();
                ctx.translate(toCX(n.x), toCY(n.y));
                
                const rad = 25 / s;
                const isCCW = val > 0;
                
                ctx.beginPath();
                const startA = -Math.PI / 4;
                const endA = -3 * Math.PI / 4;
                
                if (isCCW) {
                    ctx.arc(0, 0, rad, startA, endA, true);
                } else {
                    ctx.arc(0, 0, rad, endA, startA, false);
                }
                ctx.stroke();
                
                const arrA = isCCW ? endA : startA;
                let tAng = arrA + (isCCW ? -Math.PI / 2 : Math.PI / 2);
                
                ctx.translate(rad * Math.cos(arrA), rad * Math.sin(arrA));
                ctx.rotate(tAng);
                
                ctx.beginPath();
                ctx.moveTo(0, 0);
                const ah = 6 / s;
                ctx.lineTo(-ah, ah / 2);
                ctx.lineTo(-ah, -ah / 2);
                ctx.closePath();
                ctx.fill();
                
                ctx.rotate(-tAng);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`${label}=${Math.abs(val).toFixed(1)}`, 0, -5 / s);
                
                ctx.restore();
            };
            
            const alpha = n.supportAngle || 0;
            const s_ang = Math.sin(-alpha);
            const c_ang = Math.cos(-alpha);
            const r_local_x = r.fx * c_ang + r.fy * s_ang;
            const r_local_y = -r.fx * s_ang + r.fy * c_ang;

            drawArrow(Math.cos(alpha), Math.sin(alpha), r_local_x, 'Rx');
            drawArrow(Math.sin(alpha), -Math.cos(alpha), r_local_y, 'Ry'); 

            drawMoment(r.mz, 'Mz');
        });
    }
}
