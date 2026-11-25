! CreoToolbox DXF/DWG EXPORT font mapping (2026-10-24)
! Purpose: keep GB long-FangSong when a drawing is exported to DXF/DWG.
! Without this file Creo falls back to simplex.shx / bigfont.shx, which have
! no CJK glyphs -> the annotation font silently changes on export.
! Syntax: map_font <Creo font name> <target font file>

map_font        changfangsong             ChangFangSong.ttf
map_font        lfangsong                 ChangFangSong.ttf
map_font        LFangSong                 ChangFangSong.ttf
map_font        chfntf                    ChangFangSong.ttf
map_font        font                      ChangFangSong.ttf
map_font        filled                    ChangFangSong.ttf
map_font        isofont                   ChangFangSong.ttf
