import os
HERE=os.path.dirname(os.path.realpath(__file__)); REPO=os.path.abspath(os.path.join(HERE,'..','..'))
src=open(os.path.join(REPO,'replacement-heifer','index.html')).read()
css=src[src.index('<style>')+7:src.index('</style>')]
head='''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Herd Calculators - Texas A&amp;M AgriLife Extension</title>
<meta name="description" content="Water, ration mix, dewormer dose and withdrawal, weight gain and herd reproduction calculators for beef cattle, from public extension sources and FDA labels.">
<link rel="stylesheet" href="../brand/fonts/fonts.css">
<style>'''+css+open(os.path.join(HERE,'extra.css')).read()+'''</style>
<link rel="stylesheet" href="../brand/tamu-brand.css">
</head>
'''
page=head+open(os.path.join(HERE,'body.html')).read()+'<script>\n'+open(os.path.join(HERE,'app.js')).read()+'</script>\n</body>\n</html>\n'
os.makedirs(os.path.join(REPO,'herd-tools'), exist_ok=True)
open(os.path.join(REPO,'herd-tools','index.html'),'w').write(page); print(len(page))

# Security pass: CSP, referrer policy, required links (see tools/secure_pages.py)
import subprocess, sys
subprocess.run([sys.executable, os.path.join(REPO, 'tools', 'secure_pages.py')], check=True)
