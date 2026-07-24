export class LayoutEngine {

    constructor() {
        this.version = "1.0.0";
    }

    analyze(image) {

        console.log("Layout Engine started");

        return {
            pageWidth: image.width,
            pageHeight: image.height,

            reportBounds: null,

            verticalColumns: [],

            horizontalRows: [],

            detectedSections: {
                header: null,
                fieldData: null,
                soilDescription: null,
                laboratory: null,
                legend: null
            }
        };
    }

}
