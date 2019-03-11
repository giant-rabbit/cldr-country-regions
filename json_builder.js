var cldr = require('cldr');
var fs = require('fs');
var path = require('path');
var process = require('process');

class Country {
  constructor(code) {
    this.code = code;
    this.regions = [];
  }
}

class Region {
  constructor(code) {
    this.code = code;
  }
}

function iterateTreeLeaves(tree, types, callback) {
  for (const type of types) {
    if (type in tree) {
      const group = tree[type];
      iterateTreeLeaves(tree, group.contains, callback);
    } else {
      callback(type);
    }
  }
}

function ensureDir(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
  }
}

function nameComparison(l, r) {
  if (l.name < r.name) {
    return -1;
  } else if (l.name == r.name) {
    return 0;
  } else {
    return 1;
  }
}

class JsonBuilder {
  constructor() {
    this.countriesByCode = new Map();
    this.regionsByCode = new Map();
    this.countriesInEnglish = new Map();
    this.regionsInEnglish = new Map();
    this.regionsToSkip = [
      'usas',
      'usgu',
      'usmp',
      'uspr',
      'usum',
      'usvi',
    ];
  }

  build() {
    this.countriesInEnglish = this.buildCountries();
    this.regionsInEnglish = this.buildRegions(this.countriesInEnglish);
    this.updateCountryDataToLocale(this.countriesInEnglish, 'en');
    this.updateRegionDataToLocale(this.regionsInEnglish, 'en');
    this.writeLocaleDataFiles();
  }

  buildCountries() {
    const countriesByCode = new Map();
    const continentCodes = ['002', '019', '142', '150', '009'];
    const groups = cldr.extractTerritoryContainmentGroups();
    iterateTreeLeaves(groups, continentCodes, (leaf) => { countriesByCode.set(leaf, new Country(leaf)); });
    return countriesByCode;
  }

  buildOutputArray(countriesByCode, regionsByCode) {
    const outputArray = [];
    for (const [countryCode, country] of countriesByCode) {
      outputArray.push(country);
      country.regions.sort(nameComparison);
    }
    outputArray.sort(nameComparison);
    return outputArray;
  }

  buildRegions(countriesByCode) {
    const regionsByCode = new Map();
    const subdivisionPath = path.resolve(cldr.cldrPath, 'common', 'supplemental', 'subdivisions.xml');
    const subdivisionContainmentDoc = cldr.getDocument(subdivisionPath);
    const finder = cldr.createFinder([subdivisionContainmentDoc]);
    const subGroups = finder('/supplementalData/subdivisionContainment/subgroup');
    for (const subGroup of subGroups) {
      const countryCode = subGroup.getAttribute('type');
      if (countriesByCode.has(countryCode)) {
        const country = countriesByCode.get(countryCode);
        const contains = subGroup.getAttribute('contains');
        const regionCodes = contains.split(' ');
        for (const regionCode of regionCodes) {
          if (this.regionsToSkip.indexOf(regionCode) != -1) {
            continue;
          }
          const region = new Region(regionCode);
          regionsByCode.set(regionCode, region);
          country.regions.push(region);
        }
      }
    }
    return regionsByCode;
  }

  getSubdivisionDocForLocale(localeId) {
    const possibleLocaleIds = cldr.expandLocaleIdToPrioritizedList(localeId);
    const subdivsionsPath = path.join(cldr.cldrPath, 'common', 'subdivisions');
    let subdivisionDoc = null;
    for (const possibleLocaleId of possibleLocaleIds) {
      const subdivisionFilePath = path.join(subdivsionsPath, `${possibleLocaleId}.xml`);
      if (fs.existsSync(subdivisionFilePath)) {
        subdivisionDoc = cldr.getDocument(subdivisionFilePath);
        break;
      }
    }
    return subdivisionDoc;
  }

  resetNames(objectsByCode, objectsInEnglish) {
    for (const [code, object] of objectsByCode) {
      object.name = objectsInEnglish.get(code).name;
    }
  }

  updateCountryDataToLocale(countriesByCode, localeId) { 
    const territoryDisplayNames = cldr.extractTerritoryDisplayNames(localeId);
    for (const countryCode in territoryDisplayNames) {
      if (countriesByCode.has(countryCode)) {
        const country = countriesByCode.get(countryCode);
        const displayName = territoryDisplayNames[countryCode];
        country.name = displayName;
      }
    }
  }

  updateRegionDataToLocale(regionsByCode, localeId) {
    const subdivisionDoc = this.getSubdivisionDocForLocale(localeId);
    if (subdivisionDoc == null) {
      return;
    }
    const finder = cldr.createFinder([subdivisionDoc]);
    const subdivisions = finder('/ldml/localeDisplayNames/subdivisions/subdivision');
    for (const subdivision of subdivisions) {
      const regionCode = subdivision.getAttribute('type');
      if (regionsByCode.has(regionCode)) {
        const region = regionsByCode.get(regionCode);
        region.name = subdivision.textContent;
      }
    }
  }

  writeLocaleDataFiles() {
    const countriesByCode = this.buildCountries();
    const regionsByCode = this.buildRegions(countriesByCode);
    const dataPath = 'data';
    ensureDir(dataPath);
    for (const localeId of cldr.localeIds) {
      const prioritizedLocaleIds = cldr.expandLocaleIdToPrioritizedList(localeId);
      if (localeId != prioritizedLocaleIds[prioritizedLocaleIds.length - 1]) {
        continue;
      }
      process.stdout.write(`${localeId} ...`);
      this.resetNames(countriesByCode, this.countriesInEnglish);
      this.resetNames(regionsByCode, this.regionsInEnglish);
      this.updateCountryDataToLocale(countriesByCode, localeId);
      this.updateRegionDataToLocale(regionsByCode, localeId);
      const outputArray = this.buildOutputArray(countriesByCode, regionsByCode);
      const localePath = path.join(dataPath, localeId);
      ensureDir(localePath);
      const countriesPath = path.join(localePath, 'countries.json');
      fs.writeFileSync(countriesPath, JSON.stringify(outputArray));
      process.stdout.write("\n");
    }
  }
}

const jsonBuilder = new JsonBuilder();
jsonBuilder.build();
