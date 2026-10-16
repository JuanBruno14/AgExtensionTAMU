import os
HERE=os.path.dirname(os.path.realpath(__file__)); REPO=os.path.abspath(os.path.join(HERE,'..','..'))
src=open(os.path.join(REPO,'replacement-heifer','index.html')).read()
css=src[src.index('<style>')+7:src.index('</style>')]
head='''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Ranch · Decision Making · Texas A&amp;M AgriLife Extension</title>
<link rel="stylesheet" href="../brand/fonts/fonts.css">
<link rel="stylesheet" href="../vendor/leaflet-1.9.4/leaflet.css">
<link rel="stylesheet" href="../vendor/leaflet-geoman-2.20.2/leaflet-geoman.css">
<style>'''+css+open(os.path.join(HERE,'extra.css')).read()+'''</style>
<link rel="stylesheet" href="../brand/tamu-brand.css">
</head>
'''
page=head+open(os.path.join(HERE,'body.html')).read()+'''
<script src="../vendor/leaflet-1.9.4/leaflet.js"></script>
<script src="../vendor/leaflet-geoman-2.20.2/leaflet-geoman.min.js"></script>
<script src="../vendor/polygon-clipping-0.15.7/polygon-clipping.umd.min.js"></script>
<script>
'''+open(os.path.join(HERE,'app.js')).read().replace('/*@@FEED@@*/', open(os.path.join(HERE,'feed.js')).read()).replace('/*@@FEEDUI@@*/', open(os.path.join(HERE,'feedui.js')).read())+'''</script>
</body>
</html>
'''
open(os.path.join(REPO,'my-ranch','index.html'),'w').write(page); print(len(page))

# Security pass: CSP, referrer policy, required links (see tools/secure_pages.py)
import subprocess, sys
subprocess.run([sys.executable, os.path.join(REPO, 'tools', 'secure_pages.py')], check=True)
