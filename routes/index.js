var express = require('express');
var router = express.Router();
var http = require('http');
var https = require('https');
var keys = require('../keys.js');

var globalRes = '';
var globalReq = '';

//The url's (incl. parameters) for the api's
var apiUrls = {
	weather: function(latLng) {
		var url =
			'http://api.worldweatheronline.com/free/v1/weather.ashx?key=' +
			keys.weather + 
			'&format=json&q=' +
			latLng.lat +
			',' +
			latLng.lng;
		return url;
	},
	google: {
		distance: function(paramObj) {
			var url = 
				'https://maps.googleapis.com/maps/api/distancematrix/json?origins=' +
				paramObj.origin.lat +
				',' +
				paramObj.origin.lng +
				'&destinations=' +
				paramObj.destination.lat +
				',' +
				paramObj.destination.lng +
				'&mode=' +
				paramObj.mode +
				'&key=' +
				keys.google;
			return url;
		},
		places: function(paramObj) {
			var url = 
				'https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=' +
				paramObj.lat +
				',' +
				paramObj.lng +
				'&radius=3000&open&keyword=tourist%20attraction&key=' +
				keys.google;
			return url;
		},
		streetview: function(paramObj) {
			var url = 
				'http://maps.googleapis.com/maps/api/streetview?size=400x400&location=' +
				paramObj.lat + 
				',' +
				paramObj.lng +
				'&key=' +
				keys.google;
			return url;
		}
	}
};

//Boilerplate code for getting JSON response
function httpGet(url, callback) {
	http.get(url, function(res) {
		var chunks = [];
		res.on('data', function(chunk) {
			chunks.push(chunk);
		});
		res.on('end', function() {
			var body = chunks.join('');
			//If it is a string, parse to JSON
			if(typeof body === 'string') {
				body = JSON.parse(body);
			}
			//Pass JSON response to callback
			callback(body);
		});
  });
}
//Boilerplate code for getting JSON response
function httpsGet(url, callback) {
	https.get(url, function(res) {
		var chunks = [];
		res.on('data', function(chunk) {
			chunks.push(chunk);
		});
		res.on('end', function() {
			var body = chunks.join('');
			//If it is a string, parse to JSON
			if(typeof body === 'string') {
				body = JSON.parse(body);
			}
			//Pass JSON response to callback
			callback(body);
		});
  });
}

/* GET home page. */
router.get('/', function(req, res) {
	globalReq = req;
	globalRes = res;

	if(!req.query.lat || !req.query.lat || !req.query.address) {
		res.json({error: 'Parameters not specificed'});
	} else {
		//Get weather from latitude/longitude in request
		httpGet(apiUrls.weather({
			lat: globalReq.query.lat,
			lng: globalReq.query.lng
		}), getWeather);
	}
});

function getWeather(weather) {
	//These are the only weather codes which are 'good'
	//(i.e. not rain)
	var goodWeatherCodes = [113, 116, 119, 122, 143];
	//All weather categories to search for
	var placeCategories = 'amusement_park|aquarium|art_gallery|church|establishment|museum|place_of_worship';
	//Weather code from location (`+` converts to number)
	var weatherCode = +weather.data.current_condition[0].weatherCode;
	if(typeof weatherCode === 'number')
	//If `weatherCode` is not is in `goodWeatherCodes` then add outdoor categories
	if(goodWeatherCodes.indexOf(weatherCode) !== -1) {
		placeCategories += '|park|zoo';
	}
	getPlaces(placeCategories);
}

function getPlaces() {
	httpsGet(apiUrls.google.places({
		lat: globalReq.query.lat,
		lng: globalReq.query.lng
	}), function(json) {
		removeYeDuplicateTypes(json.results);
	});
}

function removeYeDuplicateTypes(POIs) {
	var types = {};
	var filteredPOIs = [];

	//Go through each of the POIs
	POIs.forEach(function(item) {
		var totalOfTypes = [];
		var addType = true;
		//Then go through each of the 'types' the POI has
		item.types.forEach(function(type) {
			//If it's an 'establishment' don't count to total
			if(type === 'establishment') {
				totalOfTypes.push(0);
			//Otherwise either increase the count or set it to 1
			} else {
				if(types[type]) {
					types[type]++;
				} else {
					types[type] = 1;
				}
				totalOfTypes.push(types[type]);
			}
		});
		//Now go through all of the totals
		//If any are greater than 2 than reject it
		//(i.e. there are already 2 POIs with the same types)
		totalOfTypes.forEach(function(total) {
			if(total > 2) {
				addType = false;
				}
		});
		if(addType) {
			filteredPOIs.push(item);
		}
	});
	getDistancesFromOrigin(filteredPOIs);
}

function getDistancesFromOrigin(POIs) {
	//Loop through all POI's
	//Keep a total to know when requests are done as they're async.
	var total = 1;
	POIs[0].distance = 0;
	POIs[0].streetviewUrl = apiUrls.google.streetview({
		lat: POIs[0].geometry.location.lat,
		lng: POIs[0].geometry.location.lng
	});
	var originPOI = POIs[0];
	var finalPOIs = [originPOI];

	function getDistance(POI) {
		httpsGet(apiUrls.google.distance({
				origin: {
					lat: originPOI.geometry.location.lat,
					lng: originPOI.geometry.location.lng
				},
				destination: {
					lat: POI.geometry.location.lat,
					lng: POI.geometry.location.lng
				},
				mode: 'walking'
		}), function(json) {
			console.log(json)
			POI.distance = json.rows[0].elements[0].distance.value;
			POI.streetviewUrl = apiUrls.google.streetview({
				lat: POI.geometry.location.lat,
				lng: POI.geometry.location.lng
			});
			finalPOIs.push(POI);
			if(++total === 5) {
				makeLoop(finalPOIs);
			}
		});
	}

	for(var i = 1; i < POIs.length; ++i) {
		getDistance(POIs[i]);
	}
}

//Sort POI's by distance from origin (0)
//Then form them into a 'loop'
function makeLoop(POIs) {
	//Sorts by distance in increasing order
	//(i.e. 3,4,1,2 -> 1,2,3,4)
	function sortByDistance(a, b) {
		if(a.distance < b.distance) {
			return -1;
		} else if(a.distance > b.distance) {
			return 1;
		}
		return 0;
	}

	//Creates 'loop' from sorted values
	//(i.e. 1,2,3,4 -> 14321)
	function formLoop(arr) {
		var b = [arr[arr.length-1]];
		for(var i = arr.length-2; i >= 0; --i) {
			if(!(i % 2)) {
				b.unshift(arr[i]);
			} else {
				b.push(arr[i]);
			}
		}
		b.push(arr[0]);
		return b;
	}

	var sortedPOIs = POIs.sort(sortByDistance);
	var loopedPOIs = formLoop(sortedPOIs);
	globalRes.json({
		results: loopedPOIs
	});
}

module.exports = router;