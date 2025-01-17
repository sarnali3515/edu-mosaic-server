const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middlewares
const corsOptions = {
    origin: ['http://localhost:5173', 'https://edu-mosaic-275a3.web.app', 'https://edu-mosaic-275a3.firebaseapp.com'],
    Credential: true,
    optionSuccessStatus: 200,
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sgvl42h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const courseCollection = client.db('eduMosaicDB').collection('courses')
        const userCollection = client.db('eduMosaicDB').collection('users')
        const teacherReqCollection = client.db('eduMosaicDB').collection('teacherReq')
        const enrollClassCollection = client.db('eduMosaicDB').collection('enrollClass')
        const assignmentsCollection = client.db('eduMosaicDB').collection('assignments')
        const evaluationsCollection = client.db('eduMosaicDB').collection('evaluations')
        const assignmentSubmitCollection = client.db('eduMosaicDB').collection('assignmentSubmit')

        //jwt api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })

        // middlewares jwt
        const verifyToken = (req, res, next) => {
            // console.log("inside verify", req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'forbidden access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'forbidden access' })
                }
                req.decoded = decoded;
                next();
            })
        }
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        // users related api
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // get all users
        // app.get('/users', async (req, res) => {
        //     const result = await userCollection.find().toArray();
        //     res.send(result);
        // })
        app.get('/users', async (req, res) => {
            const { search } = req.query;
            const query = search ? {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            } : {};

            const result = await userCollection.find(query).toArray();
            res.send(result);
        });

        app.get('/users/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await userCollection.findOne(query)
            res.send(result);
        })

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        // teacher req post
        app.post('/teacher-req', verifyToken, async (req, res) => {
            const teacherReqData = req.body;
            const result = await teacherReqCollection.insertOne(teacherReqData);
            res.send(result);
        })

        app.get('/teacher-req', verifyToken, async (req, res) => {
            const result = await teacherReqCollection.find().toArray();
            res.send(result);
        })

        app.get('/teacher-req/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await teacherReqCollection.find(query).toArray()
            res.send(result);
        })

        // app.get('/teacher-req/:email', async (req, res) => {
        //     const email = req.params.email
        //     const query = { teacherEmail: email }
        //     const result = await teacherReqCollection.findOne(query).toArray()
        //     res.send(result);
        // })

        // app.patch('/teacher-req/approve/:id', async (req, res) => {
        //     const id = req.params.id;
        //     const filter = { _id: new ObjectId(id) };
        //     const updatedDoc = {
        //         $set: {
        //             status: 'Approved'
        //         }
        //     }

        //     const result = await teacherReqCollection.updateOne(filter, updatedDoc);
        //     res.send();
        // })

        app.patch("/teacher-req/approve/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: "Approved",
                },
            };

            try {
                const updateTeacherReqResult = await teacherReqCollection.updateOne(filter, updatedDoc);

                if (updateTeacherReqResult.modifiedCount === 0) {
                    return res.status(404).send("Teacher request not found or already approved.");
                }

                // Retrieve approved request details
                const approvedReq = await teacherReqCollection.findOne(filter);
                const userToUpdate = { email: approvedReq.email };


                const updateUserRoleResult = await userCollection.updateOne(
                    { email: userToUpdate.email },
                    { $set: { role: "teacher", status: "Approved" } }
                );

                if (updateUserRoleResult.modifiedCount > 0) {
                    console.log("User role updated to 'teacher' successfully.");
                    res.send({ message: "Teacher request approved and role updated successfully." });
                } else {
                    console.error("Failed to update user role.");
                    res.status(500).send("Error updating user role. Teacher request approved.");
                }
            } catch (error) {
                console.error("Error updating teacher request:", error);
                res.status(500).send("Error approving teacher request.");
            }
        });

        app.patch("/teacher-req/reject/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: "Rejected",
                },
            };

            try {
                const updateTeacherReqResult = await teacherReqCollection.updateOne(filter, updatedDoc);

                if (updateTeacherReqResult.modifiedCount === 0) {
                    return res.status(404).send("Teacher request not found or approved or rejected.");
                }

                // Retrieve approved request details
                const approvedReq = await teacherReqCollection.findOne(filter);
                const userToUpdate = { email: approvedReq.email };


                const updateUserRoleResult = await userCollection.updateOne(
                    { email: userToUpdate.email },
                    { $set: { status: "Rejected" } }
                );

                if (updateUserRoleResult.modifiedCount > 0) {
                    console.log("User role updated to 'teacher' successfully.");
                    res.send({ message: "Teacher request approved and role updated successfully." });
                } else {
                    console.error("Failed to update user role.");
                    res.status(500).send("Error updating user role. Teacher request approved.");
                }
            } catch (error) {
                console.error("Error updating teacher request:", error);
                res.status(500).send("Error approving teacher request.");
            }
        });
        // app.patch('/teacher-req/reject/:id', async (req, res) => {
        //     const id = req.params.id;
        //     const filter = { _id: new ObjectId(id) };
        //     const updatedDoc = {
        //         $set: {
        //             status: 'Rejected'
        //         }
        //     }
        //     const result = await teacherReqCollection.updateOne(filter, updatedDoc);
        //     res.send(result);
        // })

        // all courses api
        app.get('/courses', async (req, res) => {
            const result = await courseCollection.find().toArray();
            res.send(result);
        })



        //get single course
        app.get('/course/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await courseCollection.findOne(query)
            res.send(result);
        })


        // post course
        app.post('/courses', async (req, res) => {
            const classData = req.body;
            const result = await courseCollection.insertOne(classData);
            res.send(result);
        })

        app.put('/my-classes/update/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedClassData = req.body;
            const query = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    ...updatedClassData,
                },
            }
            const result = await courseCollection.updateOne(query, updateDoc, options);
            res.send(result);
        })


        app.patch('/courses/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: 'Approved'
                }
            }
            const result = await courseCollection.updateOne(filter, updatedDoc);
            res.send();
        })

        app.patch('/courses/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: 'Rejected'
                }
            }
            const result = await courseCollection.updateOne(filter, updatedDoc);
            res.send();
        })

        // get added class of teacher
        app.get('/my-classes/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const query = { teacherEmail: email }
            const result = await courseCollection.find(query).toArray()
            res.send(result);
        })

        //delete class for teacher
        app.delete('/course/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await courseCollection.deleteOne(query)
            res.send(result);
        })

        // assignment 
        app.post('/assignments', verifyToken, async (req, res) => {
            const classData = req.body;
            const result = await assignmentsCollection.insertOne(classData);
            res.send(result);
        })

        app.get('/assignments/:classId', verifyToken, async (req, res) => {
            const classId = req.params.classId
            const query = { classId: classId }
            const result = await assignmentsCollection.find(query).toArray()
            res.send(result);
        })

        app.get('/enrollment/:id', verifyToken, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await enrollClassCollection.findOne(query)
            res.send(result);
        })
        app.get('/enrollments/:classId', async (req, res) => {
            const classId = req.params.classId
            const query = { classId: classId }
            const result = await enrollClassCollection.find(query).toArray()
            res.send(result);
        })

        //  payment intent
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/enroll-class', async (req, res) => {
            const payment = req.body;

            try {
                const result = await enrollClassCollection.insertOne(payment);

                const query = { _id: new ObjectId(req.body.classId) };
                const updateDoc = { $inc: { totalEnrollment: 1 } };

                const updateTotalEnrollment = await courseCollection.updateOne(query, updateDoc);

                res.send({ result, updateTotalEnrollment });
            } catch (err) {
                console.error(err);
                res.status(500).send("Internal Server Error");
            }
        })

        app.get('/enroll-class', async (req, res) => {
            const result = await enrollClassCollection.find().toArray();
            res.send(result);
        })

        app.get('/enroll-class/:email', async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await enrollClassCollection.find(query).toArray()
            res.send(result);
        })

        app.get('/enrolled-class/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await enrollClassCollection.findOne(query)
            res.send(result);
        })

        // teaching evaluation
        app.post('/evaluations', verifyToken, async (req, res) => {
            const evaluationData = req.body;
            const result = await evaluationsCollection.insertOne(evaluationData);
            res.send(result);
        })

        app.get('/evaluations', async (req, res) => {
            const result = await evaluationsCollection.find().toArray();
            res.send(result);
        })

        app.get('/evaluations/:classId', async (req, res) => {
            const classId = req.params.classId
            const query = { classId: classId }
            const result = await evaluationsCollection.find(query).toArray()
            res.send(result);
        })

        // assignment submission
        app.post('/submit-assignment', async (req, res) => {
            const assignmentSubData = req.body;
            const result = await assignmentSubmitCollection.insertOne(assignmentSubData);
            res.send(result);
        })

        app.get('/submit-assignment/:assignmentClassId', async (req, res) => {
            const assignmentClassId = req.params.assignmentClassId
            const query = { assignmentClassId: assignmentClassId }
            const result = await assignmentSubmitCollection.find(query).toArray()
            res.send(result);
        })
        app.get('/submit-day/:submissionDate', async (req, res) => {
            const submissionDate = req.params.submissionDate
            const query = { submissionDate: submissionDate }
            const result = await assignmentSubmitCollection.find(query).toArray()
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('EduMosaic is running')
})

app.listen(port, () => {
    console.log(`EduMosaic is running on port ${port}`);
})