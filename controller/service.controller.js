exports.createService = async (req, res) => {
  try {
    const { name, price, description } = req.body;

    const imageUrl = req.file ? req.file.path : "";

    const newService = await Service.create({
      name,
      price,
      description,
      image_url: imageUrl,
    });

    res.status(201).json(newService);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};