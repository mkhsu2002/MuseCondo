# MuseCondo TC Regular

This derived static font retains the SIL Open Font License 1.1, copyright and metadata of Noto Sans TC. It is independently licensed under `OFL.txt`; the project PolyForm Noncommercial license does not replace or restrict this font license. The font was renamed to avoid use of the upstream Reserved Font Name for the derivative. No resident/private image or text is part of this asset.

- Upstream: https://github.com/google/fonts/blob/b950a7257470b900078f2bf3223823a8602de7e1/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf
- Source SHA-256: `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`
- Source license: same commit `ofl/notosanstc/OFL.txt`, SHA-256 `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9`
- Derivative `MuseCondoTC-Regular.ttf`: 7,149,128 bytes; SHA-256 `d20595e7a607df9dc31a2efcd055665cbda1c8be6a8369cc06be4a77218325e5`

Reproduce with Python and `fonttools==4.68.0` in a temporary virtual environment (no need to commit the source VF or virtual environment):

```sh
python -m pip install fonttools==4.68.0
python scripts/rebuild-identity-font.py /path/to/NotoSansTC-source.ttf /path/to/MuseCondoTC-Regular.ttf
```

The script asserts tool/source/derived hashes, instantiates `wght=400`, renames name IDs 1/2/3/4/6/16/17/25, preserves all other original copyright/license records and restores the source `head.created/modified` timestamps with `recalcTimestamp=False`.

Runtime embeds this exact complete static TTF with `subset:false`. Do not switch to OTF, variable font or subset embedding without raster/glyph acceptance: previous experiments silently omitted Chinese glyphs even when text extraction appeared correct. Unsupported Unicode glyphs fail issuance without modifying the name. The public-only immutable font is loaded through the internal ASSETS binding and verified against the pinned SHA; it is not added to the Pages public bundle. The Worker public handler always returns 404, including asset paths.
