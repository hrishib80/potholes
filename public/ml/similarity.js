const PhotoSimilarity = {
    net: null,
    async load() {
        if (!this.net) {
            console.log('Loading MobileNet for similarity...');
            this.net = await mobilenet.load();
        }
    },
    async compare(imgUrl1, imgUrl2) {
        try {
            await this.load();
            const img1 = await this.loadImage(imgUrl1);
            const img2 = await this.loadImage(imgUrl2);
            const logits1 = this.net.infer(img1, true);
            const logits2 = this.net.infer(img2, true);
            const similarity = tf.losses.cosineDistance(logits1, logits2, 0);
            const score = 1 - (await similarity.data())[0];
            logits1.dispose(); logits2.dispose(); similarity.dispose();
            return Math.max(0, Math.min(100, score * 100));
        } catch (e) {
            console.warn('ML similarity failed, using pixel fallback:', e.message);
            return this.pixelFallback(imgUrl1, imgUrl2);
        }
    },
    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = url.startsWith('/') ? url : '/uploads/' + url;
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    },
    async pixelFallback(url1, url2) {
        try {
            const img1 = await this.loadImage(url1);
            const img2 = await this.loadImage(url2);
            const canvas = document.createElement('canvas');
            canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img1, 0, 0, 64, 64);
            const d1 = ctx.getImageData(0, 0, 64, 64).data;
            ctx.drawImage(img2, 0, 0, 64, 64);
            const d2 = ctx.getImageData(0, 0, 64, 64).data;
            let diff = 0;
            for (let i = 0; i < d1.length; i += 4) {
                diff += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]);
            }
            const maxDiff = 64 * 64 * 3 * 255;
            return Math.max(0, (1 - diff / maxDiff) * 100);
        } catch (e) { return 50; }
    }
};
