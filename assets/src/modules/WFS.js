/**
 * @module modules/WFS.js
 * @name WFS
 * @copyright 2023 3Liz
 * @license MPL-2.0
 */

import Utils from './Utils.js';

/**
 * @class
 * @name WFS
 */
export default class WFS {

    constructor() {
        this._defaultGetFeatureParameters = {
            repository: lizUrls.params.repository,
            project: lizUrls.params.project,
            SERVICE: 'WFS',
            REQUEST: 'GetFeature',
            VERSION: '1.0.0',
            OUTPUTFORMAT: 'GeoJSON'
        };

        this._defaultDescribeFeatureTypeParameters = {
            repository: lizUrls.params.repository,
            project: lizUrls.params.project,
            SERVICE: 'WFS',
            REQUEST: 'DescribeFeatureType',
            VERSION: '1.0.0',
            OUTPUTFORMAT: 'JSON'
        };
    }

    /**
     * @param {object} options - optional parameters which can override this._defaultParameters
     * @returns {Promise} Promise object represents data
     * @memberof WFS
     */
    async getFeature(options) {
        return Utils.fetchJSON(lizUrls.wms, {
            method: "POST",
            body: new URLSearchParams({
                ...this._defaultGetFeatureParameters,
                ...options
            })
        });
    }

    /**
     * @param {object} options - optional parameters which can override this._defaultParameters
     * @returns {Promise} Promise object represents data
     * @memberof WFS
     */
    async describeFeatureType(options) {
        return Utils.fetchJSON(lizUrls.wms, {
            method: "POST",
            body: new URLSearchParams({
                ...this._defaultDescribeFeatureTypeParameters,
                ...options
            })
        });
    }
}
