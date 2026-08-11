/* ============================================
   ASI SUB-NAV — Gold bar style
   (replaces all previous nav CSS)
   ============================================ */
   :root{
    --gold:#E8A020;   /* bump toward #F2A900 if you want it brighter */
    --ink:#0A0A0A;
  }
  /* ===== Desktop dropdown behavior — only above 1024px ===== */
  @media (min-width: 1025px) {
  
    .elementor-nav-menu > li:hover,
    .elementor-nav-menu > li:active {
        background-color: white;
        border-radius: 10px 10px 0 0;
        box-shadow: 0 14px 40px rgba(0,0,0,.15) !important;
        outline: 1px solid #E8A020 !important;
        outline-offset: -1px !important;
    }
  
    .elementor-nav-menu--main li.menu-item{
      position: relative !important;
    }
  
    .elementor-nav-menu--dropdown{
     
  
    }
  
    .elementor-nav-menu--dropdown .elementor-sub-item{
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      white-space: normal !important;
    }
  }
  
  /* ===== Font styling — fine to keep global since it's harmless on mobile ===== */
  .elementor-nav-menu--dropdown .elementor-sub-item{
    font-family: 'Montserrat', sans-serif !important;
    text-transform: uppercase !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }
  
  /* ===== Mobile popup menu — let it be its own natural full-width list ===== */
  @media (max-width: 1024px) {
    .elementor-nav-menu--dropdown{
      position: static !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    .elementor-nav-menu--dropdown .elementor-sub-item{
      white-space: normal !important;
    }
  }
  /* Main navigation background */
  .elementor-nav-menu--main {
      background-color: #ECAA0073 !important;
      padding-top: 5px;
  }
  
  /* Parent menu item */
  .elementor-nav-menu > li {
      position: relative;
  }
  
  /* Parent items with dropdown */
  .elementor-nav-menu > li.menu-item-has-children {
      
  }
  
  .elementor-nav-menu > li.menu-item-has-children > a {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-sizing: border-box;
  }
  
  /* Top parent item pill */
  .elementor-nav-menu > li:hover,
  .elementor-nav-menu > li:focus-within {
      background-color: #fff !important;
      border: 2px solid #E8A020 !important;
      border-bottom: 0 !important;
      border-radius: 18px 18px 0 0 !important;
      box-shadow: 0 14px 40px rgba(0,0,0,.15) !important;
  }
  
  /* Dropdown panel */
  .elementor-nav-menu--dropdown {
      background: #fff !important;
      border: 2px solid #E8A020 !important;
      border-top: 0 !important;
      border-radius: 0 0 12px 12px !important;
      box-shadow: 0 14px 40px rgba(0,0,0,.15) !important;
      overflow: hidden !important;
  
      width: 100% !important;
      min-width: 100% !important;
      left: 0 !important;
      margin-top:800px !important
  }
  
  /* Dropdown text rows */
  .elementor-nav-menu--dropdown .elementor-sub-item {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      font-family: 'Montserrat', sans-serif !important;
  
      text-transform: uppercase !important;
      color: #111 !important;
      background: #fff !important;
      border: none !important;
      white-space: normal !important;
     
  }
  
  /* Hover row */
  .elementor-nav-menu--dropdown .elementor-sub-item:hover,
  .elementor-nav-menu--dropdown .menu-item:hover > .elementor-sub-item {
      background: #F5D98C !important;
      color: #111 !important;
  }
  
  .elementor-sub-item:active{
      background:#ffffff !important
  }
  
  /* Remove underline/pointer */
  .elementor-nav-menu .elementor-item::before,
  .elementor-nav-menu .elementor-item::after {
      display: none !important;
      content: none !important;
  }
  
  /* Dropdown panel */
  .elementor-nav-menu--dropdown {
      position: absolute !important;
      top: 100% !important;
      left: 0 !important;
  
      margin-top: 0 !important;
      padding-top: 0 !important;
  
      background: #fff !important;
      border: 2px solid #E8A020 !important;
      border-top: 0 !important;
      border-radius: 0 0 12px 12px !important;
      box-shadow: 0 14px 40px rgba(0,0,0,.15) !important;
      overflow: hidden !important;
  
      width: 100% !important;
      min-width: 100% !important;
  }