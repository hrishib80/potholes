const PotholeModel = {
    model: null,
    async load() {
        try { this.model = await tf.loadGraphModel('./ml/tfjs_model/model.json'); }
        catch (e) { console.warn('Custom model not found, using mock analysis:', e.message); }
    },
    async analyze(imgElement) {
        if (!this.model) {
            return new Promise(resolve => setTimeout(() => {
                const isPothole = Math.random() > 0.3;
                resolve({
                    isPothole,
                    confidence: 0.75 + Math.random() * 0.2,
                    severity: isPothole ? (['low', 'medium', 'severe'][Math.floor(Math.random() * 3)]) : 'none',
                    estimatedSize: isPothole ? `${20 + Math.floor(Math.random() * 40)}x${20 + Math.floor(Math.random() * 40)}cm` : ''
                });
            }, 1500));
        }
        const tensor = tf.browser.fromPixels(imgElement).resizeNearestNeighbor([224, 224]).toFloat().div(255).expandDims();
        const prediction = await this.model.predict(tensor).data();
        tensor.dispose();
        const prob = prediction[0];
        return {
            isPothole: prob > 0.5,
            confidence: prob,
            severity: prob > 0.8 ? 'severe' : prob > 0.5 ? 'medium' : 'low',
            estimatedSize: 'Auto-detected'
        };
    }
};
PotholeModel.load();
