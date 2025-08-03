let parsed_csv = []

window.addEventListener('DOMContentLoaded', () => {
    const fileUpload = async () => {
        const data = await window.fileUpload.openFile()

        if (data?.error) {
            alert(data.error)
        }

        console.log('Parsed CSV: ', data)

        parsed_csv = data

    }


    document.getElementById('upload-button').addEventListener('click', fileUpload)
})
    
