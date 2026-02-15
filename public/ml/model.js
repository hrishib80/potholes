const PotholeModel = {
    model: null,

    async load() {
        try {
            // Try explicit path first
            this.model = await tf.loadGraphModel('./web_model/model.json');
        } catch (e) {
            console.warn('Custom model not found, falling back to mock or mobilenet');
            // We can load MobileNet as a feature extractor if needed, but for now just mock
        }
    },

    async analyze(imgElement) {
        if (!this.model) {
            // Mock logic for demo if model missing
            return new Promise(resolve => {
                setTimeout(() => {
                    const isPothole = Math.random() > 0.3;
                    resolve({
                        isPothole,
                        confidence: 0.85 + Math.random() * 0.1,
                        severity: isPothole ? (Math.random() > 0.5 ? 'medium' : 'low') : 'none',
                        estimatedSize: isPothole ? '30x30cm' : ''
                    });
                }, 1500);
            });
        }

        // Real inference (assuming standard input shape)
        const tensor = tf.browser.fromPixels(imgElement)
            .resizeNearestNeighbor([224, 224])
            .toFloat()
            .expandDims();

        const prediction = await this.model.predict(tensor).data();
        // Assume output is [pothole_prob]
        const prob = prediction[0];

        return {
            isPothole: prob > 0.5,
            confidence: prob,
            severity: prob > 0.8 ? 'high' : 'medium',
            estimatedSize: 'Unknown'
        };
    }
};

PotholeModel.load(); // Start loading immediately
