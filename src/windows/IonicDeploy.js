var INDEX_UPDATED = "INDEX_UPDATED";
var NO_DEPLOY_LABEL = "NO_DEPLOY_LABEL";
var NO_DEPLOY_AVAILABLE = "NO_DEPLOY_AVAILABLE";
var NOTHING_TO_IGNORE = "NOTHING_TO_IGNORE";
var VERSION_AHEAD = 1;
var VERSION_MATCH = 0;
var VERSION_BEHIND = -1;
var VERSION_SEPARATOR = "%";
var ZIP_FILE_NAME = "www.zip";

var storage = Windows.Storage;

var server = "https://api.ionic.io";
var app_id = "";
var last_update = undefined;
var ignore_deploy = false;

var Promise = require("./es6-promise-promise");
var JSZip = require("./JSZip");

/**
 * A general function for performing http requests to servers
 * @param {* the url for the network call} endpoint 
 * @param {* any data needed for the call} data 
 * @param {* the type of http call} type 
 */
function networkCall(endpoint, data, type) {
    return new Promise(function (resolve, reject) {
        WinJS.xhr({
            type: type,
            url: endpoint,
            responseType: "json",
            data: JSON.stringify(data),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json; charset=utf-8"
            }
        }).done(
            function completed(result) {
                if (result.status) {
                    resolve(JSON.parse(result.response));
                } else {
                    reject(result);
                }
            }, reject)
    });
}

/**
 * Get the value of a given setting
 * @param {* the name of the setting} name 
 */
function getSetting(name) {
    return WinJS.Application.local.readText(name, undefined);
}

/**
 * Get the valoue of a given setting
 * @param {* the name of the setting} name 
 * @param {* the default value should the setting not exist} defaultValue 
 */
function getSetting(name, defaultValue) {
    return WinJS.Application.local.readText(name, defaultValue);
}

/**
 * Set a specified setting to a new value
 * @param {* the name of the setting} name 
 * @param {* the new value of the setting} value 
 */
function setSetting(name, value) {
    return WinJS.Application.local.writeText(name, value);
}

/**
 * Get the latest known uuid
 * @param {* the default value should no uuid be registered} defaultUUID 
 */
function getUUID(defaultUUID) {
    return new Promise(function (resolve, reject) {
        if (defaultUUID === undefined) {
            reject("You must give a default value!");
        }

        getSetting("uuid", defaultUUID).then(function (uuid) {
            resolve(uuid);
        });
    });
}

/**
 * Get the current binary version with the following format: major.minor.build
 */
function getBinaryVersion() {
    var package = Windows.ApplicationModel.Package.current;
    var packageId = package.id;
    var version = packageId.version;
    return "" + version.major + "." + version.minor + "." + version.build;
}

/**
 * Get the current version downloaded
 */
function getMyVersions() {
    return getSetting("my_versions", "").then(function (versions_string) {
        return versions_string.length == 0 ? [] : versions_string.split(VERSION_SEPARATOR);
    });
}

/**
 * Cleanup of the currently downloaded versions
 */
function cleanupVersions() {
    return new Promise(function (resolve, reject) {
        getSetting("version_count", 0).then(function (version_count) {
            getMyVersions().then(function (versions) {
                if (version_count <= 3) {
                    resolve();
                    return;
                }

                var threshold = version_count - 3;
                var indicies_to_remove = [];
                for (var i = 0; i < versions.length; i++) {
                    var version = versions[i];
                    var version_string = version.split("|");
                    var version_number = version_string[1];

                    if (version_number < threshold) {
                        indicies_to_remove.push(i);
                    }
                }

                var promises = [];

                for (var i = 0; i < indicies_to_remove.length; i++) {
                    promises.push(removeVersion(versions[i]));
                }
                WinJS.Promise.join(promises).then(function () {
                    for (var i = 0; i < indicies_to_remove.length; i++) {
                        versions.splice(i, 1);
                    }
                });
            });
        });
    });
}

/**
 * Helper function to reset uuid and loaded_uuid settings if the give uuid 
 * is the latest registered and the one in use
 * @param {* the uuid to be deleted} uuid 
 */
function removeCurrentVersion(uuid) {
    return getUUID("").then(function (current_uuid) {
        if (uuid === current_uuid) {
            setSetting("uuid", "").then(function (result) {
                setSetting("loaded_uuid", "").then(function (res) {
                    return;
                });
            });
        }
    });
}

/**
 * Remove the given uuid from stored versions in preferences
 * @param {* the uuid to be deleted} uuid 
 */
function removeVersionFromPreferences(uuid) {
    return new Promise(function (resolve, reject) {
        getMyVersions().then(function (versions) {
            var newVersions = [];

            for (var i = 0; i < versions.length; i++) {
                var version = versions[i];
                var version_string = version.split("|");
                var tempUUID = version_string[0];
                if (tempUUID !== uuid) {
                    newVersions.push(version);
                }
            }

            saveMyVersions(newVersions).then(function () {
                resolve();
            })
        });
    });
}

/**
 * Remove a deploy version from the device
 * @param {* the uuid to be deleted} uuid 
 */
function removeVersion(uuid) {
    return new Promise(function (resolve, reject) {
        removeCurrentVersion(uuid).then(function () {
            var localFolder = storage.ApplicationData.current.localFolder;
            localFolder.getFolderAsync(uuid).then(function (storageFolder) {
                storageFolder.deleteAsync(storage.StorageDeleteOption.permanentDelete).then(function () {
                    removeVersionFromPreferences(uuid).then(function () {
                        resolve(true);
                    });
                });
            }, function (error) {
                resolve(false);
            })
        });
    })
}

/**
 * Store a list of versions in settings
 * @param {* the list of versions} versions 
 */
function saveMyVersions(versions) {
    var versions_string = "";
    for (var i = 0; i < versions.length; i++) {
        versions_string += versions[i];
        if (i !== versions.length - 1) {
            versions_string += VERSION_SEPARATOR;
        }
    }
    return setSetting("my_versions", versions_string);
}

/**
 * Checks if the given deploy version is stored on the device
 * @param {* the uuid to be tested} uuid 
 */
function hasVersion(uuid) {
    return new Promise(function (resolve, reject) {
        getMyVersions().then(function (versions) {
            for (var i = 0; i < versions.length; i++) {
                if (versions[i].split("|")[0] === uuid) {
                    resolve(true);
                }
            }
            resolve(false);
        });
    });
}

/**
 * Store a version string to the list of versions
 * @param {* the uuid to be stored} uuid 
 */
function saveVersion(uuid) {
    return new Promise(function (resolve, reject) {
        hasVersion(uuid).then(function (has_version) {
            if (has_version) {
                resolve();
            } else {
                getSetting("version_count", 0).then(function (version_count) {
                    version_count++;
                    setSetting("version_count", version_count).then(function (x) {
                        var new_uuid = uuid + "|" + version_count;
                        getMyVersions().then(function (versions) {
                            versions.push(new_uuid);
                            saveMyVersions(versions).then(function (x) {
                                cleanupVersions().then(function () {
                                    resolve();
                                });
                            });
                        });
                    });
                });
            }
        });
    });
}

/**
 * Get the list of deployed versions of the device
 */
function getDeployVersions() {
    return getMyVersions().then(function (versions) {
        var result = [];

        for (var i = 0; i < versions.length; i++) {
            var version_string = versions[i].split("|");
            result.push(version_string[0]);
        }

        return result;
    });
}

/**
 * Initialise the app id and version count
 * @param {* id of the app} appid 
 */
function initApp(appid) {
    app_id = appid;
    return new Promise(function (resolve, reject) {
        getSetting("version_count", 0).then(function (version_count) {
            setSetting("version_count", version_count).then(function (x) {
                resolve();
            });
        });
    });
}

/**
 * Post information to the cloud server to gain information about possiple updates
 * @param {* uuid of latest registered deploy version} uuid 
 * @param {* the channel where the updates are posted} channel_tag 
 */
function postDeviceDetails(uuid, channel_tag) {
    var endpoint = server + "/deploy/channels/" + channel_tag + "/check-device";

    var device_details = {
        binary_version: getBinaryVersion(),
        platform: "android"
    };
    if (uuid != "" && uuid != NO_DEPLOY_AVAILABLE) {
        device_details.snapshot = uuid;
    }

    var json = {
        channel_tag: channel_tag,
        app_id: app_id,
        device: device_details
    };

    return networkCall(endpoint, json, "post");
}

/**
 * Given a json object with information about compatibility and availability of a new update
 * determines if a new update should be downloaded and updates last_update if that is the case.
 * @param {* json object with information about the latest update in the cloud} response 
 */
function parse_update(response) {
    return new Promise(function (resolve, reject) {
        getSetting("ionicdeploy_version_ignore", "").then(function (ignore_version) {
            getSetting("loaded_uuid", "").then(function (loaded_version) {
                if (!response) {
                    console.log("PARSEUPDATE", "Unable to check for update.");
                    resolve(false);
                    return;
                }

                var update = response.data;
                var compatible = update.compatible;
                var updatesAvailable = update.available;

                if (!compatible) {
                    console.log("PARSEUPDATE", "Refusing update due to incompatible binary version.");

                    if (!updatesAvailable) {
                        resolve(false);
                        return;
                    }
                }

                var update_uuid = update.snapshot;
                if (update_uuid === ignore_version || update_uuid === loaded_version) {
                    resolve(false);
                    return;
                }

                setSetting("upstream_uuid", update_uuid).then(function (x) {
                    last_update = update;
                    resolve(true);
                });
            });
        });
    });
}

/**
 * Download an available update
 * @param {* the uri to the update to be downloaded} uriString 
 */
function downloadUpdate(uriString) {
    return new Promise(function (resolve, reject) {
        try {
            var applicationData = Windows.Storage.ApplicationData.current;
            applicationData.localFolder
                .createFileAsync(ZIP_FILE_NAME, Windows.Storage.CreationCollisionOption.replaceExisting)
                .done(function (newFile) {
                    var uri = Windows.Foundation.Uri(uriString);
                    var downloader = new Windows.Networking.BackgroundTransfer.BackgroundDownloader();
                    var download = downloader.createDownload(uri, newFile);
                    download.startAsync().then(function () {
                        getSetting("upstream_uuid", "").then(function (uuid) {
                            setSetting("uuid", uuid).then(function (x) {
                                resolve();
                            })
                        });
                    }, reject);
                });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Converts a file to uint8 array for uzipping files
 * @param {* a file on the disk} file 
 */
function getFileAsUint8Array(file) {
    return storage.FileIO.readBufferAsync(file).then(function (buffer) {
        var fileContents = new Uint8Array(buffer.length);
                var dataReader = storage.Streams.DataReader.fromBuffer(buffer);
                dataReader.readBytes(fileContents);
                dataReader.close();

                return fileContents;
    });
}

/**
 * Creates the entire folder structure for a file to be stored in if the folders do not exist or
 * some are missing
 * @param {* the folder object currently being worked on} folder 
 * @param {* array of the path to a file} parts 
 * @param {* function to call if succesfully created all folders} success 
 */
function createFolderRecursive(folder, parts, success) {
    if (parts.length <= 1) {
        success(folder);
    } else {
        folder.createFolderAsync(parts[0], storage.CreationCollisionOption.openIfExists)
            .then(function (newFolder) {
                parts.splice(0, 1);
                createFolderRecursive(newFolder, parts, success);
            }, console.log);
    }
}

/**
 * Create a folder structure for a file. Calls createFolderRecursive if file is not to be contained
 * in the root folder
 * @param {* root folder} folder 
 * @param {* path of the file} path 
 * @param {* function to call if successfully created all folders} success 
 */
function createFolders(folder, path, success) {
    var parts = path.split("/");
    if (parts.length <= 1) {
        success(folder);
    } else {
        createFolderRecursive(folder, parts, success);
    }
}

/**
 * Construct a version label for a uuid of a deployed version
 * @param {* the deployed version uuid} uuid 
 */
function constructVersionLabel(uuid) {
    var package = Windows.ApplicationModel.Package.current;
    var timestamp = package.installedDate.valueOf();
    return getBinaryVersion() + ":" + timestamp + ":" + uuid;
}

/**
 * Deconstruct a version lavel down to its components
 * @param {* label to deconstruct} label 
 */
function deconstructVersionLabel(label) {
    return label.split(":");
}


function updateVersionLabel(ignore_version) {
    return getUUID("").then(function (uuid) {
        setSetting("ionicdeploy_version_label", constructVersionLabel(uuid)).then(function (x) {
            return setSetting("ionicdeploy_version_ignore", ignore_version);
        });
    });
}

/**
 * Extract a zip file to a folder with same name as its uuid
 * @param {* name of zip file} filename 
 * @param {* uuid of version to extract} uuid 
 */
function unzip(filename, uuid) {
    return new Promise(function (resolve, reject) {
        var collission_option = storage.CreationCollisionOption.replaceExisting;
        getSetting("upstream_uuid", "").then(function (upstream_uuid) {
            hasVersion(upstream_uuid).then(function (has_version) {
                ignore_deploy = false;
                updateVersionLabel(NOTHING_TO_IGNORE);
                resolve("done");
                return;
            });

            var localFolder = storage.ApplicationData.current.localFolder;
            localFolder.createFolderAsync(uuid, collission_option).then(function (folder) {
                storage.StorageFile
                    .getFileFromPathAsync(localFolder.path.concat("\\").concat(filename))
                    .then(getFileAsUint8Array)
                    .then(function (zipFileContents) {
                        JSZip.loadAsync(zipFileContents)
                            .then(function (zip) {
                                var promises = [];
                                zip.forEach(function (zippedFile) {
                                    createFolders(folder, zippedFile, function (targetFolder) {
                                        var parts = zippedFile.split("/");
                                        var name = parts[parts.length - 1];

                                        promises.push(targetFolder.createFileAsync(name, collission_option)
                                            .then(function (localStorageFile) {
                                                zip.file(zippedFile)
                                                    .async("uint8array")
                                                    .then(function (fileContents) {
                                                        return storage.FileIO.writeBytesAsync(localStorageFile, fileContents);
                                                    });
                                            }, reject));
                                    });
                                });
                                WinJS.Promise.join(promises).then(function () {
                                    saveVersion(upstream_uuid).then(function (x) {
                                        localFolder.getFileAsync(filename).then(function (file) {
                                            file.deleteAsync(storage.StorageDeleteOption.permanentDelete).then(function () {
                                                ignore_version = false;
                                                updateVersionLabel(NOTHING_TO_IGNORE);
                                                resolve("done");
                                            });
                                        });
                                    });
                                });
                            }, reject);
                    });
            });
        });
    })
}

cordova.commandProxy.add("IonicDeploy", {
    initialize: function (success, failure, input) {
        initApp(input[0]).then(function () {
            server = input[1];
            success();
        });
    },
    check: function (success, failure, input) {
        initApp(input[0]).then(function () {
            var channel_tag = input[1];

            getUUID("").then(function (deployed_version) {
                postDeviceDetails(deployed_version, channel_tag).then(function (result) {
                    parse_update(result).then(function (update_available) {
                        if (update_available) {
                            success("true");
                        } else {
                            success("false");
                        }
                    });
                }).catch(function (error) {
                    failure(error);
                });
            });
        });
    },
    download: function (success, failure, input) { // TODO: Find way to send progress report
        initApp(input[0]).then(function () {
            getSetting("upstream_uuid", "").then(function (upstream_uuid) {
                hasVersion(upstream_uuid).then(function (has_version) {
                    if (upstream_uuid != "" && has_version) {
                        setSetting("upstream_uuid", upstream_uuid).then(function (x) {
                            success("true");
                        });
                    } else if (last_update) {
                        downloadUpdate(last_update.url).then(function () {
                            success("true");
                        }, function (err) {
                            failure(err);
                        });
                    }
                });
            });
        });
    },
    extract: function (success, failure, input) {
        initApp(input[0]).then(function () {
            getUUID("").then(function (uuid) {
                unzip("www.zip", uuid).then(function (result) {
                    success(result);
                });
            });
        });
    },
    redirect: function (success, failure, input) {
        initApp(input[0]).then(function () {
            getUUID("").then(function (uuid) {
                console.log("Humus");
                var localFolder = storage.ApplicationData.current.localFolder;
                console.log(localFolder.path);
                console.log(WinJS.Navigation);
                var url = localFolder.path + "\\" + uuid + "\\test.html";
                //window.open(url);
                window.location.replace(url);
                /*WinJS.Navigation.navigate(localFolder.path + "\\" + uuid + "\\index.html").done(function() {
                    console.log("Test");
                });*/
            });
        });
    },
    info: function (success, failure, input) {
        initApp(input[0]).then(function () {
            getUUID().then(function (uuid) {
                success({
                    deploy_uuid: uuid,
                    binary_version: getBinaryVersion()
                });
            });
        });
    },
    getVersions: function (success, failure, input) {
        initApp(input[0]).then(function () {
            getDeployVersions().then(function (result) {
                success(result);
            });
        });
    },
    deleteVersion: function (success, failure, input) {
        initApp(input[0]).then(function () {
            removeVersion(input[1]).then(function (result) {
                console.log(result);
            })
        });
    },
    getMetadata: function (success, failure, input) {
        initApp(input[0]).then(function () {
            var metadata_uuid = input[1];
            var endpoint = server + "/deploy/snapshots/" + metadata_uuid + "?app_id=" + app_id;
            networkCall(endpoint, {}, "GET").then(function (result) {
                if (result.data.user_metadata !== undefined) {
                    success({
                        metadata: result.data.user_metadata
                    });
                } else {
                    failure("There was an error fetching the metadata");
                }
            }, function (error) {
                failure("DEPLOY_HTTP_ERROR");
            });
        });
    },
    parseUpdate: function (success, failure, input) {
        var response = input[1];
        parse_update(JSON.parse(response)).then(function (result) {
            if (result) {
                success("true");
            } else {
                success("false");
            }
        })
    }
});