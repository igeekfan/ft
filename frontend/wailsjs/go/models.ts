export namespace main {
	
	export class FileInfo {
	    path: string;
	    name: string;
	    size: number;
	    hash: string;
	    modTime: string;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.hash = source["hash"];
	        this.modTime = source["modTime"];
	    }
	}
	export class DuplicateGroup {
	    hash: string;
	    size: number;
	    files: FileInfo[];
	
	    static createFrom(source: any = {}) {
	        return new DuplicateGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.size = source["size"];
	        this.files = this.convertValues(source["files"], FileInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class GroupPage {
	    groups: DuplicateGroup[];
	    total: number;
	    page: number;
	    pageSize: number;
	    totalPages: number;
	
	    static createFrom(source: any = {}) {
	        return new GroupPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], DuplicateGroup);
	        this.total = source["total"];
	        this.page = source["page"];
	        this.pageSize = source["pageSize"];
	        this.totalPages = source["totalPages"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScanHistoryItem {
	    id: number;
	    totalFiles: number;
	    totalDuplicates: number;
	    totalWasted: number;
	    scanDuration: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ScanHistoryItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.totalFiles = source["totalFiles"];
	        this.totalDuplicates = source["totalDuplicates"];
	        this.totalWasted = source["totalWasted"];
	        this.scanDuration = source["scanDuration"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class ScanResult {
	    totalFiles: number;
	    duplicateGroups: DuplicateGroup[];
	    totalDuplicates: number;
	    totalWasted: number;
	    scanDuration: string;
	    hashAlgorithm: string;
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalFiles = source["totalFiles"];
	        this.duplicateGroups = this.convertValues(source["duplicateGroups"], DuplicateGroup);
	        this.totalDuplicates = source["totalDuplicates"];
	        this.totalWasted = source["totalWasted"];
	        this.scanDuration = source["scanDuration"];
	        this.hashAlgorithm = source["hashAlgorithm"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScanStats {
	    totalFiles: number;
	    totalGroups: number;
	    totalDuplicates: number;
	    totalWasted: number;
	    scanDuration: string;
	
	    static createFrom(source: any = {}) {
	        return new ScanStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalFiles = source["totalFiles"];
	        this.totalGroups = source["totalGroups"];
	        this.totalDuplicates = source["totalDuplicates"];
	        this.totalWasted = source["totalWasted"];
	        this.scanDuration = source["scanDuration"];
	    }
	}
	export class UpdateInfo {
	    hasUpdate: boolean;
	    version: string;
	    releaseURL: string;
	    releaseNote: string;
	    publishedAt: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasUpdate = source["hasUpdate"];
	        this.version = source["version"];
	        this.releaseURL = source["releaseURL"];
	        this.releaseNote = source["releaseNote"];
	        this.publishedAt = source["publishedAt"];
	        this.error = source["error"];
	    }
	}

}

