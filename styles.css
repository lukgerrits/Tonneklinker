/* -----------------------------------------------------------
   CELLAR MAP GRID
----------------------------------------------------------- */
.rack-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

/* -----------------------------------------------------------
   CELL STYLE
----------------------------------------------------------- */
.cell {
  padding: 10px 0;
  text-align: center;
  border-radius: 10px;
  border: 1px solid #2a2e39;
  background: #15171d;
  font-size: 0.85rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    transform 0.1s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}

.cell:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px #3b455c;
}

/* -----------------------------------------------------------
   CELL HAS BOTTLES (Green indicator)
----------------------------------------------------------- */
.cell.has-bottle {
  background: #0b3a2b;
  border-color: #00ff9d;
  box-shadow: 0 0 6px rgba(0,255,157,0.4);
}

/* -----------------------------------------------------------
   HIGHLIGHT ON HOVER OF “📍 cellar” CHIP
----------------------------------------------------------- */
.cell.hover-target {
  box-shadow: 0 0 0 2px #00ffb3;
  border-color: #00ffb3;
}

/* -----------------------------------------------------------
   BLINK ANIMATION WHEN CLICKING “📍 cellar”
----------------------------------------------------------- */
@keyframes blinkCell {
  0%, 100% {
    box-shadow: 0 0 0 3px #00ffb3;
    border-color: #00ffb3;
  }
  50% {
    box-shadow: 0 0 0 3px transparent;
    border-color: #2a2e39;
  }
}

.cell.blink {
  animation: blinkCell 1.2s ease-in-out 2;
}
