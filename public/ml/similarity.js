const PhotoSimilarity = {
    net: null,

    async load() {
        if (!this.net) {
            console.log('Loading MobileNet for similarity...');
            this.net = await mobilenet.load();
        }
    },

    async compare(imgUrl1, imgUrl2) {
        await this.load();

        const img1 = await this.loadImage(imgUrl1);
        const img2 = await this.loadImage(imgUrl2);

        // Get embeddings
        const logits1 = this.net.infer(img1, true);
        const logits2 = this.net.infer(img2, true);

        // Cosine Similarity
        const similarity = tf.losses.cosineDistance(logits1, logits2, 0);
        const score = 1 - (await similarity.data())[0]; // 0-1

        // Cleanup
        img1.dispose();
        img2.dispose();
        logits1.dispose();
        logits2.dispose();

        return score * 100; // Percentage
    },

    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = '/uploads/' + url.replace('/uploads/', ''); // Ensure path
            img.onload = () => resolve(img);
            img.onerror = reject;
        });
    }
};
