"""Palette and line rules shared by every sheet.

Source: docs/design/COMMONS-STORYBOARD.md. Forest green anchors a brighter set of
cobalt, coral, ochre and lilac. Paper is warm off-white. Contour is charcoal.
Each hue has exactly one shade tone. No gradients anywhere.
"""

PAPER = "#F6F1E7"
INK = "#2B2A28"
GREEN = "#2F5D3A"
GREEN_DARK = "#24482D"
COBALT = "#2E4C8F"
COBALT_DARK = "#243C72"
CORAL = "#D9694F"
CORAL_DARK = "#B85440"
OCHRE = "#D3A045"
OCHRE_DARK = "#B2842F"
LILAC = "#9C8BC2"
LILAC_DARK = "#7F6EA6"
CREAM = "#EFE4CC"
CREAM_DARK = "#D6C8A8"
WOOD = "#A8743F"
WOOD_DARK = "#7E5530"
BRASS = "#C9A24A"
SLATE = "#4B4F63"
SLATE_DARK = "#383B4C"

# Contour width at construction scale (a 260-unit-wide figure box).
# It scales with the figure, so a 64 px figure gets a 0.8 px line.
STROKE = 3.2
