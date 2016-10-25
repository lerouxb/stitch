'use strict';

var Promise = require('bluebird');
var SphericalMercator = require('sphericalmercator');
var gd = require('node-gd');
Promise.promisifyAll(gd);
var fetch = require('node-fetch');
fetch.Promise = Promise;

function getTilePosition(lat, lon, zoom, tileSize) {
  // Which tile contains lat+lon at this zoom level and tile size and at which
  // pixel position inside that tile is it.

  var merc = new SphericalMercator({ size: tileSize });

  var xyz = merc.xyz([lon, lat, lon, lat], zoom);
  var bbox = merc.bbox(xyz.minX, xyz.minY, zoom);
  var w = bbox[0];
  var s = bbox[1];
  var e = bbox[2];
  var n = bbox[3];
  var diffLon = e - w;
  var diffLat = n - s;
  var offsetLon = lat - s;
  var offsetLat = lon - w;

  return {
    lat: lat,
    lon: lon,
    zoom: zoom,
    tileSize: tileSize,
    tileX: xyz.minX,
    tileY: xyz.minY,
    offsetX: offsetLon/diffLon * tileSize,
    offsetY: offsetLat/diffLat * tileSize
  };
}

function getStitchInfo(lat, lon, zoom, width, height, tileSize) {
  tileSize = tileSize || 256;

  var info = getTilePosition(lat, lon, zoom, tileSize);

  var cols = info.cols = Math.ceil(width / tileSize) + 2;
  var rows = info.rows = Math.ceil(height / tileSize) + 2;

  var left = info.left = info.tileX - Math.ceil(cols/2);
  var top = info.top = info.tileY - Math.ceil(rows/2);

  return info;
}

function gatherTileInfo(template, info) {
  // the tiles that we have to download and their relative x/y column and row
  // positions
  var tiles = [];
  var x;
  var y;
  for (x=0; x<info.cols; x++) {
    for (y=0; y<info.rows; y++) {
      tiles.push({
        x: x,
        y: y,
        url: template
          .replace('{z}', info.zoom)
          .replace('{x}', info.left + x)
          .replace('{y}', info.top + y)
      });
    }
  }
  return tiles;
}

function loadImage(url) {
  console.log(url);
  return fetch(url)
    .then(function(res) {
      // TODO: this can really really benefit from some conditional get type
      // caching
      if (res.status !== 200) throw new Error("StatusError: " + res.status);
      return res.buffer();
    })
    .then(function(data) {
      console.log("done");
      // data can be String or Buffer
      return gd.createFromPngPtr(data);
    });
}

function stitch(template, info) {
  return gd.createTrueColorAsync(info.cols*info.tileSize, info.rows*info.tileSize)
    .then(function(canvas) {
      var tiles = gatherTileInfo(template, info);

      return Promise.map(tiles, function(tile) {
          return loadImage(tile.url)
            .then(function(img) {
              console.log("copying");
              img.copy(canvas, tile.x*info.tileSize, tile.y*info.tileSize, 0, 0, info.tileSize, info.tileSize);
              return img.destroy();
            })
        }, { concurrency: 8 })
        .then(function() {
          // TODO: now crop out only width/height centered around lat/lon from
          // canvas
          return canvas;
        });
    });
}

function runScript(run) {
  run()
    .catch(function(err) {
      console.error(err);
      console.error(err.stack);
      process.exit(1);
    });
}

runScript(function() {
  //var info = getStitchInfo(-33.9235, 18.4176, 18, 7016, 9933, 512);
  //var info = getStitchInfo(-33.9235, 18.4176, 18, 1024, 1024, 512);

  // TODO: these things should all come from command-line parameters or
  // something rather than be hardcoded
  var lat = -33.9235;
  var lon = 18.4176;
  var zoom = 16;
  var width = 7016;
  var height = 9933;
  var tileSize = 512;

  //var template = 'http://tile.openstreetmap.org/{z}/{x}/{y}.png'; // warning: tileSize 256 only
  //var template = 'http://b.tile.stamen.com/toner/{z}/{x}/{y}@2x.png'; // warning: loves to rate limit me..
  var template = 'https://api.mapbox.com/styles/v1/lerouxb/ciupgml0h00582io4yn0dfqpy/tiles/256/{z}/{x}/{y}@2x?access_token=pk.eyJ1IjoibGVyb3V4YiIsImEiOiJjaWV5ajFjNWcwMGI4c3VtNDRtdWRoeTgzIn0.ymSpDmGfwJVXc9-oCOUsMw';

  var info = getStitchInfo(lat, lon, zoom, width, height, tileSize)
  console.log(info);
  return stitch(template, info)
    .then(function(image) {
      return image.savePng("output.png", -1)
        .tap(function() {
          image.destroy();
        });
    })
});

