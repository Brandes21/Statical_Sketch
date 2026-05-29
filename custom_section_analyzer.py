import matplotlib.pyplot as plt
import sectionproperties.pre.geometry as geometry
from sectionproperties.analysis.section import Section
from shapely.geometry import Polygon


def analyze_hollow_section_with_cutweb():
    # -------------------------------------------------------------------------
    # 1. DESIGN PARAMETERS (Dimensions in mm)
    # -------------------------------------------------------------------------
    width = 500.0
    height = 2200.0
    t_web = 30.0
    t_flange = 70.0

    # -------------------------------------------------------------------------
    # 2. GENERATE BASE HOLLOW SECTION (Outer Box minus Inner Void)
    # -------------------------------------------------------------------------
    outer_coords = [(0, 0), (width, 0), (width, height), (0, height)]

    # Inner void is offset by flange thicknesses vertically and web thicknesses horizontally
    inner_coords = [
        (t_web, t_flange),
        (width - t_web, t_flange),
        (width - t_web, height - t_flange),
        (t_web, height - t_flange),
    ]

    outer_poly = Polygon(outer_coords)
    inner_poly = Polygon(inner_coords)

    # Base hollow shape
    hollow_poly = outer_poly.difference(inner_poly)

    # -------------------------------------------------------------------------
    # 3. SUBTRACT PART OF THE LEFT WEB
    # -------------------------------------------------------------------------
    # Cut goes from top (2200) down 700mm -> reaches down to y = 1500
    cut_top_y = height
    cut_bottom_y = height - 1500

    # Cut width covers the left web (from x = 0 to x = t_web)
    cut_coords = [
        (0, cut_bottom_y),
        (t_web, cut_bottom_y),
        (t_web, cut_top_y),
        (0, cut_top_y),
    ]
    cut_poly = Polygon(cut_coords)

    # Subtract the cut region from the hollow shape
    final_poly = hollow_poly.difference(cut_poly)

    # Wrap inside sectionproperties Geometry object
    custom_geom = geometry.Geometry(final_poly)

    # -------------------------------------------------------------------------
    # 4. PLOT & VERIFY CLEAN GEOMETRY OUTLINE
    # -------------------------------------------------------------------------
    print("\n[STEP 1/5] Displaying geometry check...")
    print("--> Confirm the left web cutout looks correct, then close window.")
    custom_geom.plot_geometry()

    # -------------------------------------------------------------------------
    # 5. MESHING AND FEA PROPERTIES SETUP
    # -------------------------------------------------------------------------
    # Your walls are 30mm thick. A mesh size of ~100 to 150 ensures 
    # well-proportioned triangle density throughout the thin walls.
    custom_geom.create_mesh(mesh_sizes=[120.0])

    print("\n[STEP 2/5] Creating and processing FEA Section...")
    section = Section(custom_geom)

    # Verify the mesh layout
    section.plot_mesh()

    # Calculate structural metrics
    section.calculate_geometric_properties()
    section.calculate_warping_properties()
    section.plot_centroids()



    # ---> ADDED: Extract Centroid and Shear Center coordinates
    x_c, y_c = section.get_c()
    x_sc, y_sc = section.get_sc()  # Global Shear Center coordinates
    
    # Calculate Shear Center relative to the Centroid
    x_sc_rel = x_sc - x_c
    y_sc_rel = y_sc - y_c

    print(f"Global Shear Center (SC):      X = {x_sc:.2f} mm, Y = {y_sc:.2f} mm")
    print(f"SC Relative to Centroid:       e_x = {x_sc_rel:.2f} mm, e_y = {y_sc_rel:.2f} mm")
    print("====================================================\n")

    # Print structural summary
    print("\n================ SECTION PROPERTIES ================")
    print(f"Net Cross-Sectional Area (A):  {section.get_area():.2f} mm^2")
    print(
        f"Centroid (Neutral Axes):       X = {section.get_c()[0]:.2f} mm, Y = {section.get_c()[1]:.2f} mm"
    )
    print(f"Moment of Inertia (I_x):       {section.get_ic()[0]:.2e} mm^4")
    print(f"Moment of Inertia (I_y):       {section.get_ic()[1]:.2e} mm^4")
    print(f"Torsion Constant (J):          {section.get_j():.2e} mm^4")
    print("====================================================\n")

    # -------------------------------------------------------------------------
    # 6. APPLY DESIGN DEMANDS (Consistent units: N and N-mm)
    # -------------------------------------------------------------------------
    n_demand = -5416*1000      # Axial Force (N)
    vx_demand = 189e3     # Horizontal Shear (N)
    vy_demand = 221e3   # 250 kN Vertical Shear Force (N)
    mxx_demand = 18000e6  # 450 kNm Bending Moment around X-axis (N-mm)
    myy_demand = 121e6    # Bending Moment around Y-axis (N-mm)
    mzz_demand = 0.0    # Pure Torsion (N-mm)

    print("[STEP 4/5] Solving for FEA stress distributions...")
    stress_analysis = section.calculate_stress(
        n=n_demand,
        vx=vx_demand,
        vy=vy_demand,
        mxx=mxx_demand,
        myy=myy_demand,
        mzz=mzz_demand,
    )

    # Passing normalize=False allows the gradient scale to start cleanly at 0 MPa
    stress_analysis.plot_stress(stress="vm", cmap="viridis", normalize=False)


if __name__ == "__main__":
    analyze_hollow_section_with_cutweb()