1:1 Design-Briefing für Codex

1. Gesamtstil

Baue ein dunkles Hosting-Control-Panel im Stil von KataBump / reskinned Pterodactyl.

Der Look ist:

sehr dunkel
sehr sauber
modern
flach, aber nicht langweilig
fast alles besteht aus abgerundeten Rechtecken
keine harten 90°-Ecken
keine Glassmorphism-Effekte
keine hellen Flächen
keine sichtbaren Standard-Browser-Controls im UI selbst
nur leichte Trennung durch Farbflächen, nicht durch starke Borders

Der Eindruck ist: Deep navy / indigo dashboard, orange als Action-/Highlight-Farbe, leicht violette dunkle Panels, dezente graulila Texte.

2. Farbwelt

Nutze ungefähr diese Farben als Grundlage:

Hauptfarben
App-Hintergrund: #06083B bis #090B45
Sidebar-Hintergrund: #1F2142 bis #252544
Card-Hintergrund: #222348 bis #27274D
Input-Hintergrund: #303150 bis #353657
Fast-schwarz für Banner / Terminal / Kommandofeld: #05050D bis #0D0D16
Akzentfarben
Primär-Akzent / CTA / aktive Icons: #F25A29 bis #FF612E
Grüner Start-Button: #5FAF4D bis #6BC35A
Grauer Neutral-Button: #4A4E63
Roter Stop/Danger-Button: #A33941 bis #B23E45
Info-Cyan-Linie: #20D5F5
Textfarben
Primärtext: #F1F2FA
Sekundärtext: #A8AAC5
Gedämpfter Text: #7E82A8
Linien / Divider: rgba(255,255,255,0.08)
Logo-/Hero-Farben

Für das große Python-Banner:

Mintgrün #83F0B9
Hellblau #89C9F2
Gelb #F4D14B
Rosa #F48BA8 3) Typografie

Font aus Screens nicht sicher 100% bestimmbar, aber der Look ist klar:

Nutze Inter oder einen sehr ähnlichen modernen Sans-Font
Überschriften: semibold bis bold
Labels: regular / medium
Tabellen-/Infotext: regular
Kleine UI-Texte: 13–14px
Standardtext: 15–16px
Card-Titel: 18–22px
Große Bereichsüberschrift wie „Variables“: 44–48px, bold
Typo-Verhalten
viel Luft
keine engen Zeilen
keine übertrieben fetten Texte überall
Labels eher blass/lavendelfarben
Werte heller 4) Formensprache

Das ist extrem wichtig:

nahezu jedes UI-Element ist ein abgerundetes Rechteck
kein Element ist wirklich eckig
Cards: border-radius: 16px
Inputs: border-radius: 10px bis 12px
Buttons: border-radius: 10px bis 12px
Icon-Kacheln: border-radius: 10px
Active menu item: großer abgerundeter Block über volle Menübreite
Schatten / Konturen
kaum sichtbare Shadow
wenn überhaupt: sehr weich, sehr dunkel
keine harten Borders
Trennung eher über leicht andere Dunkelwerte 5) Grundlayout
Gesamtraster
Linke fixe Sidebar
Rechter Contentbereich füllt Rest
Sehr große horizontale Luft
Content beginnt mit großzügigem Top-Abstand
Sidebar

Breite ungefähr:

230–245px

Struktur:

Logo oben links
Server-Karte darunter
Navigationsgruppen mit Überschriften:
GENERAL
MANAGEMENT
CONFIGURATION
Account-Bereich ganz unten
Contentbereich
großzügige Seitenabstände: ca. 28–36px
vertikale Abstände zwischen Cards: 16–20px
Grid wirkt sehr ruhig und geordnet 6) Sidebar-Design im Detail
Logo-Zeile
kleines Raketen-/Mascot-Icon links
daneben „KataBump“ in weiß
Logo sitzt nicht in eigener Box, sondern direkt auf Sidebar-Hintergrund
Server-Block
Servername fett, z. B. test
darunter IP + Port in kleiner, gedämpfter Schrift
links kleines quadratisches Server-Icon/Badge
Action-Buttons unter Servername

Drei kompakte Buttons nebeneinander:

Start: grün
Restart: grau
Stop: rot

Alle:

abgerundet
gleiche Höhe
Icon zentriert
kompakt
Nav-Gruppen
Gruppentitel in kleinem Uppercase
Farbe: gedämpftes Grau-Lila
Menüpunkte mit Icon links
aktiver Menüpunkt bekommt:
dunklen rot-violetten Hintergrundblock
orangefarbenes Icon
helle Schrift 7) Topbar / Header im Content

Oben im Content:

Links oben
quadratischer Search-Button
dunkle Kachel
rund 10–12px Radius
zentriertes Lupen-Icon
Rechts oben
zwei Textlinks mit Icons:
Discord
Support center
Farbe: hellgrau
sehr clean
kein Button-Styling, eher Text + Icon 8) Cards allgemein

Alle Cards:

dunkles Indigo/Violett
Radius 16px
Padding ca. 22–26px
keine sichtbare Border
sehr leichte Layer-Trennung gegen Hintergrund
Innere Struktur
Titel oben links
Content ordentlich in Zeilen/Grid
Dividers sehr dezent 9) Dashboard-Seite
Hero-Banner

Ganz oben eine große breite Card:

Höhe ungefähr 200–220px
Hintergrund fast schwarz
in der Mitte / leicht rechts ein riesiges Python-Logo
Logo ist sehr groß, farbig, auf dunklem Hintergrund
Banner sonst schlicht, keine Texte darin
Stats-Reihe

Darunter drei identische Karten:

CPU Usage
Memory Usage
Disk Usage

Aufbau pro Karte:

links Titel in sekundärer Farbe
darunter Wert in heller Farbe
rechts eine orange Icon-Kachel
Icon-Kachel ca. 56x56 bis 64x64
orange Fläche mit weißem Symbol
Server-Info-Karten

Darunter 2-spaltiges Grid:

links Server Info
rechts weitere Server-/Node-Infos

Zeilenstruktur:

Label links
Wert rechts
horizontale Trennlinien zwischen Einträgen
Status als Badge, z. B. Offline 10) Console-Seite

Die Console-Seite besteht aus:

Oberer Bereich

Wieder dieselben drei Stats-Karten oben.

Haupt-Console

Große dunkle Card mit:

sehr großem Leerraum
Monospace-Terminalzeile oben links
gelb/orangener Prompt-Text
Text wirkt wie:
Username/Host in gelb
Statusmeldung in hell
Input-Zeile unten im Terminal
volle Breite
dunkler, leicht anderer Ton als Terminal-Hintergrund
links Prompt-/Chevron-Symbol
Platzhaltertext „Type a command…“
rechts kleine Utility-Icons (z. B. Copy / Expand)
Untere Stats

Darunter wieder Karten zu CPU / Memory / Inbound/Outbound

11. Settings-Seite
    Grid

2-spaltiger Aufbau.

Linke obere Card: SFTP Details

Enthält:

Card-Titel
Input für Server Address
Input für Username
unten Info-Hinweis mit schmaler vertikaler cyanfarbener Linie
rechts ein dunkler Button Launch SFTP
Rechte obere Card: Change Server Details
Input für Server Name
großes Textarea für Server Description
unten rechts orange Save-Button
Linke mittlere Card: Debug Information
einfache Infozeilen
Werte rechts als kleine dunkle Pills / Code-Badges
Linke untere Card: Reinstall Server
erklärender Absatz
unten rechts Danger-Outline-Button
roter Rand, dunkler Hintergrund, helle Schrift 12) Files-Seite
Obere Toolbar-Card

Breite Toolbar mit:

Checkbox links
Breadcrumb / Pfad: / home / container /
mittig/rechts Suchfeld
rechts mehrere kleine quadratische Icon-Buttons
ganz rechts zwei orange Buttons:
Upload
New file / Create
Darunter Dateiliste

Große Tabellen-Card:

Headerzeile mit name, size, date
dezente Sort-Pfeile
Empty-State-Text mittig:
„This directory seems to be empty.“ 13) Databases / Backups / Users / Schedules / Network

Diese Seiten folgen alle derselben Sprache:

Tabellen-Card
großer dunkler Block
Headerzeile mit Spaltennamen
Zeilen optional
wenn leer: Empty State mittig
Network
eine Card mit Allocation-Tabelle
IP, Port, Notes
Notes als Input
Primary als orange Badge/Button rechts
Schedules
rechts oben in der Card ein orangefarbener Create schedule-Button
Users
rechts oben New user-Button in orange
Backups / Databases
tabellarisch, clean, kaum visuelles Rauschen 14) Startup-Seite

Die Startup-Seite ist sehr charakteristisch.

Obere Karten
links große Card Startup Command
rechts kleinere Card Docker Image
Startup Command
im Inneren ein fast schwarzes Eingabefeld / Codefeld
Text: python /home/container/app.py
wirkt wie Terminal-/Command-Strip
Docker Image
Dropdown mit dunklem Hintergrund
z. B. Python 3.14
rechts Chevron
Bereichsüberschrift

Darunter groß:

Variables
groß, hell, bold
Variablen-Karten

2 Spalten:

ADDITIONAL PY MODULES
PY FILE

Jede Card:

Label oben links in Uppercase
großes dunkles Inputfeld
darunter kleiner Hilfetext in Grau 15) Inputs, Buttons, Badges
Inputs
Hintergrund dunkler als Card, aber heller als Page-Background
keine harte Border
innere Padding großzügig
Text hell
Placeholder grau-lila
Radius 10–12px
Primärbutton
Hintergrund orange
Text weiß
semibold
Radius 10–12px
kein starker Schatten
Sekundärbutton
dunkler Hintergrund
heller Text
ggf. dünne subtile Border
Danger-Button
dunkler Hintergrund
rote Outline
helle Schrift
Badge
klein
rounded
orange oder dunkel
kompakt gepaddet 16) Icons
lineare UI-Icons
modern, clean
eher dünn bis medium stroke
meistens links vor Text oder in quadratischen Icon-Kacheln
orange Action-Icons auf Dashboard
helle Icons in Topbar
orange aktives Nav-Icon 17) Abstände und Rhythmus

Ungefähr so:

äußerer Content-Padding: 32px
Card-Gap: 16px bis 20px
Card-Padding: 24px
Input-Höhe: 42px bis 48px
Standard-Button-Höhe: 40px bis 46px
Sidebar-Item-Höhe: 44px bis 50px

Der wichtigste Eindruck:

viel Luft
alles sitzt sauber im Raster
kein Element klebt aneinander
nichts wirkt gequetscht 18) Was Codex auf keinen Fall falsch machen darf
keine weißen Karten
keine harten schwarzen Borders
keine eckigen Rechtecke
keine grellen Neonfarben außer dem kontrollierten Orange
keine Material-UI-Optik
keine Glass-/Blur-Effekte
keine zu runden „pill-only“ Buttons überall
keine zu hellen Texte auf sekundären Ebenen
keine Standard-HTML-Inputs
keine starken Box-Shadows
kein bunter Gradient-Hintergrund im Layout selbst
Gradient nur im großen Python-Banner / Logo-Motiv
