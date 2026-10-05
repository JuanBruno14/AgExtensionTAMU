import os
HERE=os.path.dirname(os.path.abspath(__file__)); REPO=os.path.abspath(os.path.join(HERE,'..','..'))
src=open(os.path.join(REPO,'replacement-heifer','index.html')).read()
css=src[src.index('<style>')+7:src.index('</style>')]
head='''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Texas A&amp;M AgriLife Extension - Decision Making</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&family=Oswald:wght@400;500;600&family=Work+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css">
<style>'''+css+open(os.path.join(HERE,'extra.css')).read()+'''</style>
<link rel="stylesheet" href="../brand/tamu-brand.css">
</head>
'''
page=head+open(os.path.join(HERE,'body.html')).read()+'''
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/dist/polygon-clipping.umd.min.js"></script>
<script>
'''+open(os.path.join(HERE,'app.js')).read().replace('/*@@FEED@@*/', open(os.path.join(HERE,'feed.js')).read()).replace('/*@@FEEDUI@@*/', open(os.path.join(HERE,'feedui.js')).read())+'''</script>
</body>
</html>
'''
open(os.path.join(REPO,'my-ranch','index.html'),'w').write(page); print(len(page))
